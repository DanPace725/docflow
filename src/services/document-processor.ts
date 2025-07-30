import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer";
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 3000;
const MAX_DELAY_MS = 30000;

export interface PurchaseOrderData {
  poNumber?: string;
  poDate?: string;
  vendor?: string;
  total?: number;
  items: POItem[];
}

export interface POItem {
  description?: string;
  pu_quant?: number;  // replaces quantity
  pu_price?: number;  // replaces unitPrice
  total?: number;     // replaces amount
  pr_codenum?: string;  // replaces productCode
}

export interface InvoiceDetails {
  InvoiceId?: string;
  InvoiceDate?: string;
  DueDate?: string;
  VendorName?: string;
  VendorAddress?: string;
  CustomerName?: string;
  CustomerAddress?: string;
  SubTotal?: number;
  TotalTax?: number;
  InvoiceTotal?: number;
}

export interface InvoiceItem {
  Description?: string;
  Quantity?: number;
  Unit?: string;
  UnitPrice?: number;
  ProductCode?: string;
  Amount?: number;
}

export type InvoiceData = any; // Temporary for debugging

export interface ProcessingResult {
  success: boolean;
  data?: PurchaseOrderData | InvoiceData;
  error?: string;
}

// Helper function to extract table data
const extractTableData = (table: any) => {
  const rows: string[][] = [];
  let currentRow = -1;
  
  table.cells
    .sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex)
    .forEach(cell => {
      if (cell.rowIndex !== currentRow) {
        rows.push([]);
        currentRow = cell.rowIndex;
      }
      rows[rows.length - 1].push(cell.content);
    });
  
  return rows;
};

// Helper function to replace headers
const replaceImportHeaders = (df: any[]) => {
  if (df.length === 0) return df;
  
  // Convert headers to lowercase but keep original if no match found
  let headers = df[0].map((h: string) => h.toLowerCase());
  
  // Try to enhance headers where we can recognize them
  headers = headers.map(h => {
    if (["order", "items", "quantity", "qty"].includes(h)) return "pu_quant";
    if (["cost", "unit price", "price", "#"].includes(h)) return "pu_price";
    if (h === "amount" || h === "total") return "total";
    return h; // Keep original header if no match
  });
  
  // Check for part number pattern
  const partNumberPattern = /P\d{2}-\d{3}-\d{3}/;
  headers.forEach((h, index) => {
    const hasPartNumber = df.slice(1).some(row => 
      partNumberPattern.test(row[index]?.toString() || '')
    );
    if (hasPartNumber) {
      headers[index] = 'pr_codenum';
    }
  });
  
  return [headers, ...df.slice(1)];
};

// Function to split PDF into pages
export const splitPdf = async (file: File): Promise<File[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const pageCount = pdfDoc.getPageCount();
  
  // Get base name without .pdf extension
  const baseName = file.name.replace('.pdf', '');
  const splitPages: File[] = [];
  
  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    newPdf.addPage(copiedPage);
    
    const pdfBytes = await newPdf.save();
    // Create sequential filename: 0507_1.pdf, 0507_2.pdf, etc.
    const pageFile = new File(
      [pdfBytes], 
      `${baseName}_${i + 1}.pdf`,
      { type: 'application/pdf' }
    );
    
    splitPages.push(pageFile);
  }
  
  return splitPages;
};


// Helper function to extract and map invoice data from Azure result
const extractInvoiceData = (result: any): InvoiceData => {
  const document = result.documents[0];
  // For debugging, just return the raw fields object
  return document.fields;
};

// Function to analyze documents with Azure Form Recognizer
export const analyzeDocument = async (
  file: File,
  documentType: string,
): Promise<ProcessingResult> => {
  try {
    const endpoint = import.meta.env.VITE_AZURE_FORM_RECOGNIZER_ENDPOINT;
    const key = import.meta.env.VITE_AZURE_FORM_RECOGNIZER_KEY;
    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    
    const fileBuffer = await file.arrayBuffer();
    const modelId = documentType === 'invoice' ? 'prebuilt-invoice' : 'prebuilt-document';

    // Retry mechanism configuration
    const maxRetries = MAX_RETRIES;
    const initialDelay = INITIAL_DELAY_MS; // in milliseconds

    let poller;
    let result;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        poller = await client.beginAnalyzeDocument(modelId, fileBuffer);
        result = await poller.pollUntilDone();
        break; // Success, exit loop
      } catch (error: any) { // Ensure 'error' is typed as 'any' or a more specific error type if known
        lastError = error;
        if (attempt < maxRetries) {
          let currentDelay = 0;
          let isAzureSuggestedDelay = false;

          // Check for Azure Form Recognizer specific error structure for rate limiting
          // Typical Azure errors have a 'statusCode' property.
          if (error.statusCode === 429) {
            // 1. Check for error.retryAfterInMs (Azure SDK specific)
            if (typeof error.retryAfterInMs === 'number') {
              currentDelay = error.retryAfterInMs;
              isAzureSuggestedDelay = true;
            } else {
              // 2. Check for Retry-After header (may need to inspect error.response.headers)
              // This part is complex as direct header access depends on the SDK's error structure.
              // For now, we'll simulate checking a common way it might be exposed.
              // This might need adjustment based on actual error objects.
              const retryAfterHeader = error.response?.headers?.get('retry-after') || error.response?.headers?.['retry-after'];
              if (retryAfterHeader) {
                const retryAfterSeconds = parseInt(retryAfterHeader, 10);
                if (!isNaN(retryAfterSeconds)) {
                  currentDelay = retryAfterSeconds * 1000;
                  isAzureSuggestedDelay = true;
                }
              }
            }

            // 3. Parse error message if no other delay was found yet
            if (!isAzureSuggestedDelay && error.message) {
              const messageMatch = error.message.match(/retry after (\d+) seconds/i);
              if (messageMatch && messageMatch[1]) {
                const retryAfterSeconds = parseInt(messageMatch[1], 10);
                if (!isNaN(retryAfterSeconds)) {
                  currentDelay = retryAfterSeconds * 1000;
                  isAzureSuggestedDelay = true;
                }
              }
            }
          }

          // If no Azure suggested delay, or not a 429 error, use exponential backoff
          if (!isAzureSuggestedDelay) {
            currentDelay = initialDelay * Math.pow(2, attempt);
          }

          currentDelay = Math.min(currentDelay, MAX_DELAY_MS);

          let delaySourceMessage = isAzureSuggestedDelay ? "Azure-suggested delay" : "exponential backoff";
          console.warn(
            `Attempt ${attempt + 1} of ${maxRetries + 1} failed for document "${file.name}". ` +
            `Error: ${error.message}. ` +
            `Retrying in ${currentDelay}ms (using ${delaySourceMessage}).`
          );
          await new Promise(resolve => setTimeout(resolve, currentDelay));
        } else {
          console.error(
            `All ${maxRetries + 1} attempts to process document "${file.name}" failed. Last error:`,
            lastError // lastError should contain the full error object
          );
          throw lastError; // Re-throw the last error after all retries
        }
      }
    }

    if (result) {
      if (documentType === 'invoice') {
        if (result.documents && result.documents.length > 0) {
          const invoiceData = extractInvoiceData(result);
          return { success: true, data: invoiceData };
        } else {
          return { success: false, error: 'No invoice data found in document' };
        }
      } else { // 'purchase-order'
        if (result.tables && result.tables.length > 0) {
          const processedTables = result.tables.map(table => {
            const tableData = extractTableData(table);
            const processedData = replaceImportHeaders(tableData);

            const headers = processedData[0];
            const items = processedData.slice(1).map(row => {
              const item: any = {};
              headers.forEach((header, index) => {
                const value = row[index];
                item[header] = isNaN(parseFloat(value)) ? value : parseFloat(value);
              });
              return item;
            });
            return items;
          });
          
          const items = processedTables.flat();
          const poData: PurchaseOrderData = {
            items,
            poNumber: '',
            poDate: '',
            vendor: '',
            total: items.reduce((sum, item) => sum + (item.total || 0), 0)
          };
          return { success: true, data: poData };
        } else {
          return { success: false, error: 'No table data found in document' };
        }
      }
    }
    
    return { success: false, error: 'No result from Azure Form Recognizer' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Function to generate Excel output
export const generateExcelOutput = async (
  data: PurchaseOrderData | InvoiceData,
  documentType: string,
  fileName: string
): Promise<{ url: string; fileName: string }> => {
  const wb = XLSX.utils.book_new();
  const excelFileName = fileName.replace('.pdf', '.xlsx');

  if (documentType === 'invoice') {
    // Handle InvoiceData (which is now the raw 'fields' object)
    const fields = data as any;

    // Create a sheet for raw top-level field data
    const detailsToExport = Object.entries(fields)
      .filter(([key]) => key !== 'Items')
      .map(([key, value]: [string, any]) => ({
        FieldName: key,
        Type: value.type,
        Value: value.value ? JSON.stringify(value.value) : null,
        Content: value.content,
        Confidence: value.confidence,
      }));

    const detailsWs = XLSX.utils.json_to_sheet(detailsToExport);
    XLSX.utils.book_append_sheet(wb, detailsWs, 'Raw Details');

    // Create a sheet for the raw line items, if they exist
    if (fields.Items && Array.isArray(fields.Items.values)) {
      const itemsToExport = fields.Items.values.map((item: any, index: number) => {
        const flatItem: any = { ItemIndex: index };
        if (item.properties) {
          for (const [propKey, propValue] of Object.entries(item.properties as any)) {
            flatItem[`${propKey}_Type`] = propValue.type;
            flatItem[`${propKey}_Value`] = propValue.value ? JSON.stringify(propValue.value) : null;
            flatItem[`${propKey}_Content`] = propValue.content;
            flatItem[`${propKey}_Confidence`] = propValue.confidence;
          }
        }
        return flatItem;
      });
      const itemsWs = XLSX.utils.json_to_sheet(itemsToExport);
      XLSX.utils.book_append_sheet(wb, itemsWs, 'Raw Line Items');
    }

  } else if (documentType === 'purchase-order' && 'items' in data) {
    // Handle PurchaseOrderData
    const poData = data as PurchaseOrderData;
    const sanitizedItems = poData.items.map(item => {
      const sanitizedItem: POItem = {};
      (Object.keys(item) as Array<keyof POItem>).forEach(key => {
        const value = item[key];
        (sanitizedItem as any)[key] = (typeof value === 'string' && value.trim() === '') ? null : value;
      });
      return sanitizedItem;
    });

    const itemsWs = XLSX.utils.json_to_sheet(sanitizedItems);
    XLSX.utils.book_append_sheet(wb, itemsWs, 'Line Items');
  }

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const url = URL.createObjectURL(blob);
  return { url, fileName: excelFileName };
};

export const generateAggregatedExcelOutput = async (
  items: InvoiceItem[],
  baseFileName: string
): Promise<{ url: string; fileName: string }> => {
  const wb = XLSX.utils.book_new();
  const excelFileName = baseFileName.replace('.pdf', '_aggregated.xlsx');

  const itemsWs = XLSX.utils.json_to_sheet(items);
  XLSX.utils.book_append_sheet(wb, itemsWs, 'Aggregated Line Items');

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  const url = URL.createObjectURL(blob);
  return { url, fileName: excelFileName };
};
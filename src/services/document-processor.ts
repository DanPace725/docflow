import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer";
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';

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

export interface ProcessingResult {
  success: boolean;
  data?: PurchaseOrderData;
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
    const modelId = 'prebuilt-document';

    // Retry mechanism configuration
    const maxRetries = 3;
    const initialDelay = 1000; // in milliseconds

    let poller;
    let result;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        poller = await client.beginAnalyzeDocument(modelId, fileBuffer);
        result = await poller.pollUntilDone();
        break; // Success, exit loop
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt);
          console.warn(`Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`All ${maxRetries + 1} attempts failed.`, error);
          throw lastError; // Re-throw the last error after all retries
        }
      }
    }

    if (result && result.tables?.length) {
      // Process each table like in Python
      const processedTables = result.tables.map(table => {
        // Extract raw table data
        const tableData = extractTableData(table);
        // Process headers and data
        const processedData = replaceImportHeaders(tableData);
        
        // Convert to POItems
        const headers = processedData[0];
        const items = processedData.slice(1).map(row => {
          const item: any = {};
          
          headers.forEach((header, index) => {
            const value = row[index];
            // Try to convert to number if possible, otherwise keep as string
            item[header] = isNaN(parseFloat(value)) ? value : parseFloat(value);
          });
          
          return item;
        });
        
        return items;
      });
      
      // Combine all tables' items
      const items = processedTables.flat();
      
      const poData: PurchaseOrderData = {
        items,
        poNumber: '',
        poDate: '',
        vendor: '',
        total: items.reduce((sum, item) => sum + (item.total || 0), 0)
      };

      return { success: true, data: poData };
    }
    
    return { success: false, error: 'No table data found in document' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Function to generate Excel output - simplified for line items only
export const generateExcelOutput = async (
  data: PurchaseOrderData,
  documentType: string,
  fileName: string
): Promise<{ url: string; fileName: string }> => {  // Changed return type here
  const wb = XLSX.utils.book_new();
  const itemsWs = XLSX.utils.json_to_sheet(data.items);
  
  // Use the PDF name (without .pdf) for the Excel file
  const excelFileName = fileName.replace('.pdf', '.xlsx');
  
  XLSX.utils.book_append_sheet(wb, itemsWs, 'Line Items');
  
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  const url = URL.createObjectURL(blob);
  return { url, fileName: excelFileName };
};
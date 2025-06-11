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
  
  // Check for part number pattern and rename only the first matching column
  const partNumberPattern = /P\d{2}-\d{3}-\d{3}/;
  let prCodeNumAssigned = false; // Flag to ensure only one column is named 'pr_codenum'
  headers = headers.map((h, index) => {
    if (prCodeNumAssigned) return h; // If 'pr_codenum' is already assigned, keep original header

    const columnData = df.slice(1).map(row => row[index]?.toString() || '');
    const hasPartNumber = columnData.some(cellContent => partNumberPattern.test(cellContent));

    if (hasPartNumber) {
      prCodeNumAssigned = true;
      return 'pr_codenum';
    }
    return h; // Keep original header if no part number pattern match
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
  console.log('[Data Quality] Starting data processing for Excel generation...');
  const processedItems = data.items.map((item, index) => {
    const newItem: POItem = {};
    let warnings = [];

    // pr_codenum
    if (item.pr_codenum === null || item.pr_codenum === undefined || String(item.pr_codenum).trim() === "") {
      newItem.pr_codenum = null;
      // This case is handled by the filter later, but good to note if it was initially problematic
      if (item.pr_codenum !== null && item.pr_codenum !== undefined) { // Log if it was not already null/undefined
          warnings.push(`Original 'pr_codenum' was present but empty/whitespace, now null.`);
      }
    } else if (typeof item.pr_codenum === 'string') {
      const trimmedPrCodeNum = item.pr_codenum.trim();
      if (item.pr_codenum !== trimmedPrCodeNum) {
        warnings.push(`Trimmed 'pr_codenum' from "${item.pr_codenum}" to "${trimmedPrCodeNum}".`);
      }
      newItem.pr_codenum = trimmedPrCodeNum;
    } else {
      warnings.push(`Original 'pr_codenum' ("${item.pr_codenum}") was not a string, set to null.`);
      newItem.pr_codenum = null;
    }

    // description
    if (item.description === null || item.description === undefined || String(item.description).trim() === "") {
      newItem.description = null;
      if (item.description !== null && item.description !== undefined) {
           warnings.push(`Original 'description' was present but empty/whitespace, now null.`);
      }
    } else if (typeof item.description === 'string') {
      const trimmedDescription = item.description.trim();
      if (item.description !== trimmedDescription) {
        warnings.push(`Trimmed 'description' from "${item.description}" to "${trimmedDescription}".`);
      }
      newItem.description = trimmedDescription;
    } else {
      warnings.push(`Original 'description' ("${item.description}") was not a string, set to null.`);
      newItem.description = null;
    }

    const parseNumeric = (val: any, fieldName: string): number | null => {
      if (typeof val === 'number') return val;
      if (val === null || val === undefined || String(val).trim() === "") return null;
      const num = parseFloat(String(val));
      if (isNaN(num)) {
        warnings.push(`Could not parse '${fieldName}' value ("${val}") to a number, set to null.`);
        return null;
      }
      if (String(val) !== String(num)) { // e.g. "010" vs 10, or "12.3.4" vs 12.3
           warnings.push(`Numeric conversion for '${fieldName}': original "${val}", parsed to "${num}".`);
      }
      return num;
    };

    newItem.pu_quant = parseNumeric(item.pu_quant, 'pu_quant');
    newItem.pu_price = parseNumeric(item.pu_price, 'pu_price');
    newItem.total = parseNumeric(item.total, 'total');

    // Retain other properties
    for (const key in item) {
      if (!(key in newItem) && item.hasOwnProperty(key)) {
        (newItem as any)[key] = (item as any)[key];
      }
    }

    if (warnings.length > 0) {
      console.warn(`[Data Quality] Item at index ${index} (original data):`, item, 'Warnings:', warnings.join('; '));
    }
    return newItem;
  });
  console.log('[Data Quality] Finished data processing.');

  const wb = XLSX.utils.book_new();
  const filteredItems = processedItems.filter(item => item.pr_codenum && item.pr_codenum.trim() !== "");

  const skippedItemCount = processedItems.length - filteredItems.length;
  if (skippedItemCount > 0) {
    console.warn(`[Data Quality] Skipped ${skippedItemCount} items due to missing or empty 'pr_codenum'.`);
    // Optionally, log the actual skipped items if it's not too verbose
    // processedItems.forEach(item => {
    //   if (!item.pr_codenum || item.pr_codenum.trim() === "") {
    //     console.warn('[Data Quality] Skipped item:', item);
    //   }
    // });
  }

  const itemsWs = XLSX.utils.json_to_sheet(filteredItems);
  
  // Use the PDF name (without .pdf) for the Excel file
  const excelFileName = fileName.replace('.pdf', '.xlsx');
  
  XLSX.utils.book_append_sheet(wb, itemsWs, 'Line Items');
  
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  const url = URL.createObjectURL(blob);
  return { url, fileName: excelFileName };
};
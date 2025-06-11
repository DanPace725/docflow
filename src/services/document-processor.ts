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
      rows[rows.length - 1].push(String(cell.content ?? ""));
    });
  
  return rows;
};

// Helper function to replace headers
// This function now receives all rows as dataRows and assigns headers based on predefined list and content pattern matching.
const replaceImportHeaders = (dataRows: string[][]): { headers: string[]; rows: string[][] } => {
  if (!dataRows || dataRows.length === 0 || !dataRows[0] || dataRows[0].length === 0) {
    return { headers: [], rows: dataRows };
  }

  const numCols = dataRows[0].length;

  const predefinedHeaders = [
    'pr_codenum',      // Standardized Part Number
    'description',     // Item Description
    'pu_quant',        // Quantity
    'pu_price',        // Unit Price
    'total',           // Line Total
    'unit_of_measure', // e.g., EA, LF, BAGS
    'vendor_sku',      // Vendor's own part number/SKU, if present
    'notes'            // Any other notes or details
  ];

  // Initial Header Assignment
  let assignedHeaders: string[] = [];
  for (let i = 0; i < numCols; i++) {
    if (i < predefinedHeaders.length) {
      assignedHeaders.push(predefinedHeaders[i]);
    } else {
      assignedHeaders.push(`column_${i + 1}`); // Generic name for extra columns
    }
  }

  // Identify and Set `pr_codenum` Header (Part Number Column Identification)
  const partNumberPattern = /P\d{2}-\d{3}-\d{3}/i; // Case-insensitive for 'P'
  let foundPrCodeNumPatternColumn = -1;

  // First pass: find which column (if any) matches the part number pattern
  for (let colIndex = 0; colIndex < numCols; colIndex++) {
    const columnData = dataRows.map(row => String(row[colIndex] ?? ""));
    if (columnData.some(cellContent => partNumberPattern.test(cellContent))) {
      foundPrCodeNumPatternColumn = colIndex;
      break; // Found the first column
    }
  }

  // Second pass: assign headers, ensuring 'pr_codenum' is correctly placed.
  if (foundPrCodeNumPatternColumn !== -1) { // A pattern-matching column was found
    const finalHeaders = assignedHeaders.map((header, colIndex) => {
      if (colIndex === foundPrCodeNumPatternColumn) return 'pr_codenum';
      // If this column was initially 'pr_codenum' but isn't the pattern column, make it generic
      if (header === 'pr_codenum') return `column_${colIndex + 1}`;
      return header; // Keep the initially assigned header
    });
    assignedHeaders = finalHeaders;
  }
  // If no pattern column found, the initial assignment (which might have 'pr_codenum' as first predefined) stands.

  return { headers: assignedHeaders, rows: dataRows }; // dataRows is returned unmodified
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
    const maxRetries = 3; // Total 4 attempts (1 initial + 3 retries)
    const initialDelay = 3000; // Increased initial delay to 3 seconds
    const maxDelay = 30000; // Maximum delay of 30 seconds for exponential backoff

    let poller;
    let result;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Azure Form Recognizer: Attempt ${attempt + 1} for document ${file.name}`);
        poller = await client.beginAnalyzeDocument(modelId, fileBuffer);
        result = await poller.pollUntilDone();
        console.log(`Azure Form Recognizer: Successfully analyzed document ${file.name} on attempt ${attempt + 1}`);
        break; // Success, exit loop
      } catch (error: any) { // Explicitly type error as any to access properties
        lastError = error;
        console.warn(`Azure Form Recognizer: Attempt ${attempt + 1} for document ${file.name} failed.`);

        if (attempt < maxRetries) {
          let delay = initialDelay * Math.pow(2, attempt); // Default exponential backoff

          // Check for Azure SDK specific retry information
          if (error.statusCode === 429) { // "Too Many Requests"
            console.warn("Azure Form Recognizer: Received 429 (Too Many Requests).");
            let suggestedDelayMs: number | undefined;

            // Prefer error.retryAfterInMs if available (newer SDK versions)
            if (typeof error.retryAfterInMs === 'number') {
              suggestedDelayMs = error.retryAfterInMs;
              console.log(`Using Azure SDK provided error.retryAfterInMs: ${suggestedDelayMs}ms`);
            }
            // Fallback to checking headers for 'retry-after' (older SDKs or direct RESTError)
            // The header value is usually in seconds.
            else if (error.response?.headers?.get("retry-after")) {
              const retryAfterSeconds = parseInt(error.response.headers.get("retry-after")!, 10);
              if (!isNaN(retryAfterSeconds)) {
                suggestedDelayMs = retryAfterSeconds * 1000;
                console.log(`Using 'retry-after' header: ${retryAfterSeconds}s => ${suggestedDelayMs}ms`);
              }
            }
             // Check if the error message itself contains a retry period (common in Azure messages)
            else {
                const messageMatch = error.message?.match(/retry after (\d+) seconds/i);
                if (messageMatch && messageMatch[1]) {
                    const retryAfterSeconds = parseInt(messageMatch[1], 10);
                    if (!isNaN(retryAfterSeconds)) {
                        suggestedDelayMs = retryAfterSeconds * 1000;
                        console.log(`Parsed 'retry after X seconds' from error message: ${retryAfterSeconds}s => ${suggestedDelayMs}ms`);
                    }
                }
            }

            if (suggestedDelayMs !== undefined && suggestedDelayMs > 0) {
              delay = suggestedDelayMs; // Use the service-suggested delay
            }
          }

          // Cap the delay to maxDelay
          delay = Math.min(delay, maxDelay);

          console.warn(`Azure Form Recognizer: Retrying document ${file.name} in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries + 1})`, error.message || error);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`Azure Form Recognizer: All ${maxRetries + 1} attempts failed for document ${file.name}.`, error);
          throw lastError; // Re-throw the last error after all retries
        }
      }
    }

    if (result && result.tables?.length) {
      const allItems: POItem[] = []; // Accumulate items from all tables

      result.tables.forEach(table => {
        const rawTableData = extractTableData(table);
        const { headers, rows: dataRows } = replaceImportHeaders(rawTableData); // New call

        if (headers.length === 0) { // Skip if no headers were assigned (e.g. empty table)
            return;
        }

        const tableItems = dataRows.map(row => {
          const item: any = {};
          headers.forEach((header, index) => {
            const value = row[index]; // row is already a string[]
            // Attempt to convert to number if it's a numeric header, otherwise keep as string
            // This primitive conversion logic might need refinement based on POItem types
            if (['pu_quant', 'pu_price', 'total'].includes(header)) {
                const numValue = parseFloat(value);
                item[header] = isNaN(numValue) ? value : numValue; // Keep string if NaN
            } else {
                item[header] = value;
            }
          });
          return item as POItem; // Cast to POItem
        });
        allItems.push(...tableItems);
      });
      
      const poData: PurchaseOrderData = {
        items: allItems, // Use the accumulated items
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
  console.log('[Data Quality] Starting data processing for Excel generation (revised rules)...');
  const processedItems = data.items.map((item, index) => {
    const newItem: POItem = {} as POItem; // Initialize with type assertion
    let warnings: string[] = [];

    // Helper function to process string fields
    const processStringField = (value: any, fieldName: string): string | null => {
      if (value === null || value === undefined) {
        // warnings.push(`Field '${fieldName}' was originally null or undefined.`);
        return null;
      }
      let strValue = String(value);
      const trimmedValue = strValue.trim();

      if (strValue !== trimmedValue && trimmedValue !== "") {
        warnings.push(`Trimmed '${fieldName}' from "${strValue}" to "${trimmedValue}".`);
      }

      if (trimmedValue === "") {
        if (strValue !== "") { // It became empty only after trimming
           warnings.push(`Field '${fieldName}' ("${strValue}") became empty after trimming, set to null.`);
        } else {
           // warnings.push(`Field '${fieldName}' was originally empty string.`);
        }
        return null; // Represents a blank cell
      }
      return trimmedValue;
    };

    // Helper function to process numeric fields (preserve string if not parsable)
    const processNumericField = (value: any, fieldName: string): number | string | null => {
      if (value === null || value === undefined) {
        // warnings.push(`Field '${fieldName}' (numeric) was originally null or undefined.`);
        return null;
      }

      let strValue = String(value).trim(); // Trim first
      if (strValue === "") {
          // warnings.push(`Field '${fieldName}' (numeric) was originally empty or whitespace string.`);
          return null; // Blank cell
      }

      // Attempt to remove common currency symbols and thousand separators for robust parsing
      const cleanedStrValue = strValue.replace(/[\$,]/g, '');

      const num = parseFloat(cleanedStrValue);

      if (isNaN(num)) {
        warnings.push(`Could not parse '${fieldName}' value ("${strValue}") as a number. Preserving original trimmed string: "${strValue}".`);
        return strValue; // Preserve original (trimmed) string if not a number
      }

      if (strValue !== String(num) && cleanedStrValue !== String(num)) { // Log if cleaning or parsing changed representation
         warnings.push(`Numeric conversion for '${fieldName}': original "${strValue}", parsed to ${num}.`);
      }
      return num;
    };

    newItem.pr_codenum = processStringField(item.pr_codenum, 'pr_codenum');
    newItem.description = processStringField(item.description, 'description');

    newItem.pu_quant = processNumericField(item.pu_quant, 'pu_quant');
    newItem.pu_price = processNumericField(item.pu_price, 'pu_price');
    newItem.total = processNumericField(item.total, 'total');

    // Retain any other properties from the original item
    // This ensures any fields not explicitly processed are still carried over.
    for (const key in item) {
      if (!(key in newItem) && item.hasOwnProperty(key)) {
        (newItem as any)[key] = (item as any)[key];
      }
    }

    if (warnings.length > 0) {
      console.warn(`[Data Quality] Item at index ${index} (original data):`, JSON.parse(JSON.stringify(item)), 'Processed to:', JSON.parse(JSON.stringify(newItem)), 'Warnings:', warnings.join('; '));
    }
      // Unconditional log for every item
      console.log(`[Data Quality] Processing Item ${index}:`,
                  { original: JSON.parse(JSON.stringify(item)), processed: JSON.parse(JSON.stringify(newItem)), itemWarnings: warnings.length > 0 ? warnings.join('; ') : 'No warnings' }
      );
    return newItem;
  });
  console.log('[Data Quality] Finished data processing (revised rules).');

  const finalItems = processedItems.filter(item => {
    // A row is considered non-blank if at least one of its property values is not null.
    // (Our processing functions convert empty strings/whitespace to null for blankness)
    return Object.values(item).some(value => value !== null);
  });

  if (processedItems.length !== finalItems.length) {
    console.log(`[Data Quality] Removed ${processedItems.length - finalItems.length} entirely blank rows before Excel generation.`);
  }

  const wb = XLSX.utils.book_new();
  const itemsWs = XLSX.utils.json_to_sheet(finalItems); // Use finalItems
  
  // Use the PDF name (without .pdf) for the Excel file
  const excelFileName = fileName.replace('.pdf', '.xlsx');
  
  XLSX.utils.book_append_sheet(wb, itemsWs, 'Line Items');
  
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  const url = URL.createObjectURL(blob);
  return { url, fileName: excelFileName };
};
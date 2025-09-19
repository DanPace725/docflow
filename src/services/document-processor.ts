import { AzureKeyCredential, DocumentAnalysisClient, DocumentField } from "@azure/ai-form-recognizer";
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
  // Core standardized fields (these will exist after header processing)
  description?: string;
  pu_quant?: number;  
  pu_price?: number;  
  total?: number;     
  pr_codenum?: string;  
  
  // Allow any additional fields from the original table
  [key: string]: any;}

export interface ProcessingResult {
  success: boolean;
  data?: PurchaseOrderData;
  error?: string;
  statusCode?: number;
}

// Helper function to detect if a row looks like data instead of headers
const detectDataRow = (row: string[]): boolean => {
  // Patterns that suggest this is data, not headers
  const dataPatterns = [
    /P\d{2}-\d{3}-\d{3}/, // Part number pattern
    /^\d+$/, // Pure numbers (quantities)
    /\$\d+\.\d{2}/, // Dollar amounts
    /\d+\.\d+/, // Decimal numbers
    /^\d+\s+P\d{2}/, // Quantity followed by part number
  ];
  
  // Count how many cells look like data
  const dataMatches = row.filter(cell => 
    dataPatterns.some(pattern => pattern.test(cell?.toString() || ''))
  ).length;
  
  // If more than half the cells look like data, treat as data row
  const threshold = Math.max(1, Math.floor(row.length / 2));
  return dataMatches >= threshold;
};

// Helper function to handle tables without proper headers
const handleHeaderlessTable = (tableData: string[][]): string[][] => {
  console.log('Processing headerless table');
  
  if (tableData.length === 0) return tableData;
  
  // Analyze the structure to create intelligent headers
  const numColumns = Math.max(...tableData.map(row => row.length));
  const headers: string[] = [];
  
  // For each column, analyze the data to guess what it might be
  for (let colIndex = 0; colIndex < numColumns; colIndex++) {
    const columnValues = tableData.map(row => row[colIndex] || '').filter(v => v.trim() !== '');
    
    if (columnValues.length === 0) {
      headers[colIndex] = `Column_${colIndex + 1}`;
      continue;
    }
    
    // Check for patterns in this column
    const hasPartNumbers = columnValues.some(v => /P\d{2}-\d{3}-\d{3}/.test(v));
    const hasMoneyFirst = columnValues.some(v => /^\$\d+\.\d{2}$/.test(v)); // Unit prices
    const hasMoneyLast = columnValues.some(v => /^\$\d+\.\d{2}$/.test(v)); // Could be totals
    const hasQuantities = columnValues.some(v => /^\d+$/.test(v));
    const hasDimensions = columnValues.some(v => /\d+[\-\/]\d+/.test(v) || /\d+\s*X\s*\d+/.test(v));
    const hasUnits = columnValues.some(v => /^(EA|EACH|PC|PCS)$/i.test(v));
    
    // Assign intelligent column names based on patterns
    if (hasPartNumbers) {
      headers[colIndex] = 'pr_codenum';
    } else if (hasQuantities && colIndex === 0) {
      headers[colIndex] = 'pu_quant'; // First column with numbers is usually quantity
    } else if (hasMoneyFirst && colIndex < numColumns - 2) {
      headers[colIndex] = 'pu_price'; // Money in early columns is usually unit price
    } else if (hasMoneyLast && colIndex === numColumns - 1) {
      headers[colIndex] = 'total'; // Last money column is usually total
    } else if (hasUnits) {
      headers[colIndex] = 'unit';
    } else if (hasDimensions) {
      headers[colIndex] = 'description';
    } else {
      // Generic column name
      headers[colIndex] = `Column_${colIndex + 1}`;
    }
  }
  
  // Look for duplicate standard headers and rename
  const standardHeaders = ['pu_quant', 'pu_price', 'total', 'pr_codenum'];
  const usedStandardHeaders = new Set<string>();
  
  headers.forEach((header, index) => {
    if (standardHeaders.includes(header)) {
      if (usedStandardHeaders.has(header)) {
        // Duplicate standard header, make it generic
        headers[index] = `${header}_${index + 1}`;
      } else {
        usedStandardHeaders.add(header);
      }
    }
  });
  
  console.log('Generated headers for headerless table:', headers);
  
  // Return data with generated headers
  return [headers, ...tableData];
};

// Enhanced table extraction that handles missing/irregular cells
const extractTableData = (table: any) => {
  if (!table.cells || table.cells.length === 0) {
    console.warn('Table has no cells');
    return [];
  }

  // Find table dimensions
  const maxRow = Math.max(...table.cells.map(cell => cell.rowIndex));
  const maxCol = Math.max(...table.cells.map(cell => cell.columnIndex));
  
  // Initialize complete grid with empty strings
  const grid: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    grid[r] = new Array(maxCol + 1).fill('');
  }
  
  // Fill in the actual cell content
  table.cells.forEach(cell => {
    const row = cell.rowIndex;
    const col = cell.columnIndex;
    grid[row][col] = cell.content || '';
  });
  
  console.log(`Extracted table: ${grid.length} rows, ${grid[0]?.length || 0} columns`);
  return grid;
};

// Enhanced header replacement with collision detection and data preservation
const replaceImportHeaders = (tableData: string[][]): string[][] => {
  if (tableData.length === 0) {
    console.warn('Empty table data provided');
    return tableData;
  }
  
  // Create a copy to avoid mutating original data
  const processedData = tableData.map(row => [...row]);
  let headers = processedData[0].map(h => (h || '').toLowerCase().trim());
  
  console.log('Original headers:', headers);
  
  // Check if we should process headers at all
  const targetWords = ["order", "items", "quantity", "qty", "cost", "unit price", "price", "#", "amount", "total", "unit", "each", "ea"];
  const hasTargetWords = headers.some(h => 
    targetWords.some(target => h.includes(target))
  );
  
  // Additional check: detect if first row looks like data instead of headers
  const firstRowLooksLikeData = detectDataRow(processedData[0]);
  
  if (!hasTargetWords || firstRowLooksLikeData) {
    console.log('No target words found in headers OR first row appears to be data - treating as headerless table');
    return handleHeaderlessTable(processedData);
  }

  // If we get here, we have proper headers - continue with normal processing
  console.log('Processing table with proper headers');
  
  // Track which standardized headers we've already assigned
  const assignedStandardHeaders = new Set<string>();
  const newHeaders = [...headers]; // Start with original headers
  
  // Handle "amount" column special positioning logic FIRST
  const amountIndices = headers
    .map((h, i) => h.includes('amount') ? i : -1)
    .filter(i => i !== -1);
    
  amountIndices.forEach(index => {
    if (index === 0 && !assignedStandardHeaders.has('pu_quant')) {
      newHeaders[index] = 'pu_quant';
      assignedStandardHeaders.add('pu_quant');
      console.log(`Mapped "amount" at position ${index} (first) to "pu_quant"`);
    } else if (index === headers.length - 1 && !assignedStandardHeaders.has('total')) {
      newHeaders[index] = 'total';
      assignedStandardHeaders.add('total');
      console.log(`Mapped "amount" at position ${index} (last) to "total"`);
    }
  });
  
  // Define mapping priorities (first match wins for each standard header)
  const mappingRules = [
    {
      standardName: 'pu_quant',
      patterns: ['quantity', 'qty', 'order', 'items'],
      priority: ['quantity', 'qty', 'order', 'items'] // preferred order
    },
    {
      standardName: 'pu_price', 
      patterns: ['unit price', 'price', 'cost', '#'],
      priority: ['unit price', 'price', 'cost', '#']
    },
    {
      standardName: 'total',
      patterns: ['total'],
      priority: ['total']
    }
  ];
  
  // Apply mapping rules with collision detection
  mappingRules.forEach(rule => {
    if (assignedStandardHeaders.has(rule.standardName)) {
      return; // Already assigned
    }
    
    // Find the best match based on priority
    let bestMatch = -1;
    let bestPriority = Infinity;
    
    headers.forEach((header, index) => {
      // Skip if this position was already standardized
      if (newHeaders[index] !== header) return;
      
      rule.patterns.forEach(pattern => {
        if (header.includes(pattern)) {
          const priority = rule.priority.indexOf(pattern);
          if (priority !== -1 && priority < bestPriority) {
            bestMatch = index;
            bestPriority = priority;
          }
        }
      });
    });
    
    if (bestMatch !== -1) {
      newHeaders[bestMatch] = rule.standardName;
      assignedStandardHeaders.add(rule.standardName);
      console.log(`Mapped "${headers[bestMatch]}" to "${rule.standardName}" at index ${bestMatch}`);
    }
  });
  
  // Handle part number detection
  if (!assignedStandardHeaders.has('pr_codenum')) {
    const partNumberPattern = /P\d{2}-\d{3}-\d{3}/;
    
    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      // Skip if this column was already standardized
      if (newHeaders[colIndex] !== headers[colIndex]) continue;
      
      // Check if this column contains part numbers
      const hasPartNumber = processedData.slice(1).some(row => {
        const cellValue = row[colIndex]?.toString() || '';
        return partNumberPattern.test(cellValue);
      });
      
      if (hasPartNumber) {
        newHeaders[colIndex] = 'pr_codenum';
        assignedStandardHeaders.add('pr_codenum');
        console.log(`Found part numbers in column ${colIndex}, mapped to "pr_codenum"`);
        break; // Only map the first column with part numbers
      }
    }
  }
  
  console.log('Final headers:', newHeaders);
  console.log('Assigned standard headers:', Array.from(assignedStandardHeaders));
  
  // Return processed data with new headers
  return [newHeaders, ...processedData.slice(1)];
};

// Helper function to extract value from a DocumentField, supporting V5 and older SDK versions
const getFieldValue = (field: DocumentField | undefined, type: 'string' | 'number' | 'date' | 'currency'): any => {
  if (!field) {
    return undefined;
  }

  // V5 SDK-specific value types
  if (type === 'string' && field.valueString) return field.valueString;
  if (type === 'number' && field.valueNumber) return field.valueNumber;
  if (type === 'date' && field.valueDate) return field.valueDate;
  if (type === 'currency' && field.valueCurrency) return field.valueCurrency.amount;

  // Fallback for older SDK versions or generic 'value'
  if (field.value) {
    if (type === 'currency' && typeof field.value === 'object' && field.value !== null && 'amount' in field.value) {
      return (field.value as any).amount;
    }
    // For other types, the plain value is sufficient.
    return field.value;
  }

  return undefined;
};

// Enhanced analyze document function
export const analyzeDocument = async (
  file: File,
  documentType: string,
): Promise<ProcessingResult> => {
  const endpoint = import.meta.env.VITE_AZURE_FORM_RECOGNIZER_ENDPOINT;
  const key = import.meta.env.VITE_AZURE_FORM_RECOGNIZER_KEY;
  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

  const fileBuffer = await file.arrayBuffer();
  const modelId = 'prebuilt-purchaseOrder';

  console.log(`Processing document: ${file.name} with model: ${modelId}`);

  // Retry mechanism
  const maxRetries = MAX_RETRIES;
  const initialDelay = INITIAL_DELAY_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const poller = await client.beginAnalyzeDocument(modelId, fileBuffer);
      const result = await poller.pollUntilDone();

      const { documents } = result;

      if (documents && documents.length > 0) {
        const document = documents[0];
        console.log(`Successfully extracted document of type: ${document.docType}`);
        const { fields } = document;

        const allItems: POItem[] = [];
        const itemsField = fields.Items;

        if (itemsField) {
          // SDK v5 uses `valueArray`, older versions might use `values`
          const items = itemsField.valueArray ?? (itemsField as any).values;

          if (items) {
            for (const itemField of items) {
              // SDK v5 uses `valueObject`, older versions might use `properties`
              const props = itemField.valueObject ?? (itemField as any).properties;

              if (props) {
                const poItem: POItem = {
                  description: getFieldValue(props.Description, 'string'),
                  pu_quant: getFieldValue(props.Quantity, 'number'),
                  pu_price: getFieldValue(props.UnitPrice, 'currency'),
                  total: getFieldValue(props.Amount, 'currency'),
                  pr_codenum: getFieldValue(props.ProductCode, 'string'),
                };
                allItems.push(poItem);
              }
            }
          }
        }

        const poData: PurchaseOrderData = {
          poNumber: getFieldValue(fields.PurchaseOrderNumber, 'string'),
          poDate: getFieldValue(fields.PurchaseOrderDate, 'date')?.toString(),
          vendor: getFieldValue(fields.VendorName, 'string'),
          total: getFieldValue(fields.SubTotal, 'currency') ?? getFieldValue(fields.Total, 'currency'),
          items: allItems,
        };

        console.log(`Extracted PO# ${poData.poNumber} from vendor ${poData.vendor}`);
        return { success: true, data: poData };

      } else if (result && result.tables?.length) {
        // Fallback for older payloads that might not have `documents` but have `tables`.
        console.warn('No documents found in result, attempting to process tables as a fallback.');
        
        console.log(`Found ${result.tables.length} tables in document`);

        const allItems: POItem[] = [];
        
        result.tables.forEach((table, tableIndex) => {
          console.log(`Processing table ${tableIndex}:`);
          const rawTableData = extractTableData(table);
          if (rawTableData.length === 0) return;
          
          const processedData = replaceImportHeaders(rawTableData);
          if (processedData.length < 2) return;

          const headers = processedData[0];
          const tableItems = processedData.slice(1).map((row) => {
            const item: any = {};
            headers.forEach((header, colIndex) => {
              const value = row[colIndex] || '';
              if (value.toString().trim() !== '') {
                const numValue = parseFloat(value.toString());
                item[header] = isNaN(numValue) ? value : numValue;
              } else {
                item[header] = value;
              }
            });
            return item;
          });
          allItems.push(...tableItems);
        });
        
        const poData: PurchaseOrderData = {
          items: allItems,
          poNumber: file.name.replace('.pdf', ''),
          poDate: '',
          vendor: '',
          total: allItems.reduce((sum, item) => sum + (item.total || 0), 0)
        };

        console.log(`Total items processed from tables: ${allItems.length}`);
        return { success: true, data: poData };
      }
      
      return { success: false, error: 'No structured document or table data found' };

    } catch (error: any) {
      console.error(`Attempt ${attempt + 1} for ${file.name} failed. Error: ${error.message}`);

      if (attempt < maxRetries) {
        let currentDelay = initialDelay * Math.pow(2, attempt);

        if (error.statusCode === 429) {
          const retryAfterHeader = error.response?.headers?.get('retry-after');
          if (retryAfterHeader) {
            const retryAfterSeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(retryAfterSeconds)) {
              currentDelay = retryAfterSeconds * 1000;
            }
          } else if (error.retryAfterInMs) {
            currentDelay = error.retryAfterInMs;
          } else {
            const match = error.message.match(/retry after (\d+) seconds/i);
            if (match && match[1]) {
              currentDelay = parseInt(match[1], 10) * 1000;
            }
          }
        }

        currentDelay = Math.min(currentDelay, MAX_DELAY_MS);
        console.warn(`Retrying in ${currentDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
      } else {
        console.error(`All retries failed for ${file.name}.`);
        // On final failure, return the error details directly
        return { success: false, error: error.message, statusCode: error.statusCode };
      }
    }
  }
  // This part should be unreachable if the loop logic is correct, but it satisfies TypeScript
  return { success: false, error: 'Exited analysis loop unexpectedly.' };
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
// Function to generate Excel output - PRESERVES ALL DATA
export const generateExcelOutput = async (
  data: PurchaseOrderData,
  documentType: string,
  fileName: string
): Promise<{ url: string; fileName: string }> => {
  console.log(`Generating Excel for ${data.items.length} items`);
  
  // Sanitize items data for Excel generation - PRESERVE ALL COLUMNS
  const sanitizedItems = data.items.map((item, index) => {
    const sanitizedItem: Record<string, any> = {}; // Use Record to allow any keys
    
    // Iterate over ALL keys in the actual item, not just POItem keys
    Object.keys(item).forEach(key => {
      const value = item[key as keyof typeof item];
      
      if (typeof value === 'string' && value.trim() === '') {
        // If string is empty or only whitespace, set to null for Excel
        sanitizedItem[key] = null;
      } else if (value === undefined || value === null) {
        // Handle undefined/null values
        sanitizedItem[key] = null;
      } else {
        // Otherwise, keep the original value
        sanitizedItem[key] = value;
      }
    });
    
    // Log the first few items to help debug
    if (index < 3) {
      console.log(`Item ${index} columns:`, Object.keys(sanitizedItem));
      console.log(`Item ${index} sample data:`, sanitizedItem);
    }
    
    return sanitizedItem;
  });
  
  // Log total unique columns across all items
  const allColumns = new Set<string>();
  sanitizedItems.forEach(item => {
    Object.keys(item).forEach(key => allColumns.add(key));
  });
  console.log(`Total unique columns: ${allColumns.size}`, Array.from(allColumns).sort());
  
  // Check for our standard columns
  const standardColumns = ['pu_quant', 'pu_price', 'pr_codenum', 'total'];
  const foundStandardColumns = standardColumns.filter(col => allColumns.has(col));
  console.log(`Found standard columns: ${foundStandardColumns.join(', ')}`);
  
  const wb = XLSX.utils.book_new();
  
  // Use sanitizedItems for generating the worksheet
  const itemsWs = XLSX.utils.json_to_sheet(sanitizedItems);
  
  const excelFileName = fileName.replace('.pdf', '.xlsx');
  
  XLSX.utils.book_append_sheet(wb, itemsWs, 'Line Items');
  
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { 
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
  
  const url = URL.createObjectURL(blob);
  
  console.log(`Excel file created: ${excelFileName} with columns: ${Array.from(allColumns).sort().join(', ')}`);
  return { url, fileName: excelFileName };
};

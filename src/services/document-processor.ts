import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer";
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 3000;
const MAX_DELAY_MS = 30000;

export type DocumentType = 'purchase-order' | 'invoice';

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

export interface InvoiceData {
  fields: Record<string, any>;
  lineItems: Record<string, any>[];
}

export interface InvoiceExcelData {
  details: Record<string, any>[];
  lineItems: Record<string, any>[];
}

type SuccessfulPurchaseOrderResult = {
  success: true;
  documentType: 'purchase-order';
  data: PurchaseOrderData;
};

type SuccessfulInvoiceResult = {
  success: true;
  documentType: 'invoice';
  data: InvoiceData;
};

type FailedProcessingResult = {
  success: false;
  error: string;
  statusCode?: number;
};

export type ProcessingResult =
  | SuccessfulPurchaseOrderResult
  | SuccessfulInvoiceResult
  | FailedProcessingResult;

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

const getFieldValue = (field: any): any => {
  if (field === undefined || field === null) {
    return null;
  }

  if (typeof field !== 'object') {
    return field;
  }

  const kind = field.kind || field.valueType;

  if (kind === 'array' && Array.isArray(field.values)) {
    return field.values.map((value: any) => getFieldValue(value));
  }

  if (kind === 'object' && field.properties) {
    const obj: Record<string, any> = {};
    Object.entries(field.properties).forEach(([key, value]) => {
      obj[key] = getFieldValue(value);
    });
    return obj;
  }

  if (Array.isArray(field.value)) {
    return field.value.map((value: any) => getFieldValue(value));
  }

  if (field.value !== undefined) {
    return field.value;
  }

  if (field.content !== undefined) {
    return field.content;
  }

  if (field.properties) {
    const obj: Record<string, any> = {};
    Object.entries(field.properties).forEach(([key, value]) => {
      obj[key] = getFieldValue(value);
    });
    return obj;
  }

  return field;
};

const extractInvoiceLineItems = (itemsField: any): Record<string, any>[] => {
  if (!itemsField) {
    return [];
  }

  const values = Array.isArray(itemsField.values)
    ? itemsField.values
    : Array.isArray(itemsField.value)
      ? itemsField.value
      : [];

  return values.map((itemField: any) => {
    if (!itemField) {
      return {};
    }

    const kind = itemField.kind || itemField.valueType;

    if (kind === 'object' && itemField.properties) {
      const result: Record<string, any> = {};
      Object.entries(itemField.properties).forEach(([key, value]) => {
        result[key] = getFieldValue(value);
      });
      return result;
    }

    if (itemField.value && typeof itemField.value === 'object') {
      const result: Record<string, any> = {};
      Object.entries(itemField.value).forEach(([key, value]) => {
        result[key] = getFieldValue(value);
      });
      return result;
    }

    return getFieldValue(itemField);
  });
};

const buildInvoiceDataFromFields = (fields: Record<string, any> = {}): InvoiceData => {
  const headerData: Record<string, any> = {};
  const lineItems: Record<string, any>[] = [];

  Object.entries(fields).forEach(([fieldName, fieldValue]) => {
    if (fieldName.toLowerCase() === 'items') {
      lineItems.push(...extractInvoiceLineItems(fieldValue));
    } else {
      headerData[fieldName] = getFieldValue(fieldValue);
    }
  });

  return {
    fields: headerData,
    lineItems,
  };
};

export const aggregateInvoiceData = (
  invoices: InvoiceData[],
  sourcePages: string[],
  options: { includeSourcePage?: boolean } = {}
): InvoiceExcelData => {
  const details: Record<string, any>[] = [];
  const lineItems: Record<string, any>[] = [];
  const includeSourcePage = options.includeSourcePage ?? false;

  invoices.forEach((invoice, index) => {
    const pageLabel = sourcePages[index] ?? `Page ${index + 1}`;

    const detailRow: Record<string, any> = { ...invoice.fields };
    if (includeSourcePage) {
      const detailKey = detailRow.hasOwnProperty('__source_page')
        ? `__source_page_${index + 1}`
        : '__source_page';
      detailRow[detailKey] = pageLabel;
    }
    details.push(detailRow);

    invoice.lineItems.forEach((lineItem) => {
      const lineItemRow: Record<string, any> = { ...lineItem };
      if (includeSourcePage) {
        const lineKey = lineItemRow.hasOwnProperty('__source_page')
          ? `__source_page_${index + 1}`
          : '__source_page';
        lineItemRow[lineKey] = pageLabel;
      }
      lineItems.push(lineItemRow);
    });
  });

  return {
    details,
    lineItems,
  };
};

const sanitizeRecordForExcel = (record: Record<string, any>): Record<string, any> => {
  const sanitized: Record<string, any> = {};

  Object.entries(record).forEach(([key, value]) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      sanitized[key] = trimmed === '' ? null : value;
    } else if (value === null) {
      sanitized[key] = null;
    } else if (value === undefined) {
      sanitized[key] = undefined;
    } else {
      sanitized[key] = value;
    }
  });

  return sanitized;
};

const parseRetryAfterFromMessage = (message?: string): number | undefined => {
  if (!message) {
    return undefined;
  }

  const match = message.match(/retry after\s+(\d+)\s*seconds?/i);
  if (match && match[1]) {
    const seconds = parseInt(match[1], 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }

  return undefined;
};

const computeRetryDelay = (error: any, attempt: number): { delay: number; reason: 'exponential backoff' | 'Azure-suggested delay'; } => {
  let delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
  let reason: 'exponential backoff' | 'Azure-suggested delay' = 'exponential backoff';

  if (error) {
    if (typeof error.retryAfterInMs === 'number' && !isNaN(error.retryAfterInMs)) {
      delay = error.retryAfterInMs;
      reason = 'Azure-suggested delay';
    } else {
      const retryAfterHeader = error.response?.headers?.get?.('retry-after')
        ?? error.response?.headers?.['retry-after'];

      if (retryAfterHeader !== undefined) {
        const numericHeader = Number(retryAfterHeader);
        if (!isNaN(numericHeader)) {
          // Retry-After is typically provided in seconds. If the value looks like seconds, convert to ms.
          delay = numericHeader > 1000 ? numericHeader : numericHeader * 1000;
          reason = 'Azure-suggested delay';
        }
      } else {
        const parsedFromMessage = parseRetryAfterFromMessage(error.message);
        if (parsedFromMessage !== undefined) {
          delay = parsedFromMessage;
          reason = 'Azure-suggested delay';
        }
      }
    }
  }

  delay = Math.min(delay, MAX_DELAY_MS);
  return { delay, reason };
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
  const normalizedType: DocumentType = documentType === 'invoice' ? 'invoice' : 'purchase-order';
  const modelId = normalizedType === 'invoice' ? 'prebuilt-invoice' : 'prebuilt-document';

  console.log(`Processing document: ${file.name} using model ${modelId}`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const poller = await client.beginAnalyzeDocument(modelId, fileBuffer);
      const result = await poller.pollUntilDone();

      if (normalizedType === 'invoice') {
        const invoiceDocument = result?.documents?.[0];
        const fields = invoiceDocument?.fields;

        if (!fields) {
          return { success: false, error: 'No invoice data found in document.' };
        }

        const invoiceData = buildInvoiceDataFromFields(fields);
        return {
          success: true,
          documentType: 'invoice',
          data: invoiceData,
        };
      }

      if (result && result.tables?.length) {
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
          total: allItems.reduce((sum, item) => sum + (item.total || 0), 0),
        };

        console.log(`Total items processed: ${allItems.length}`);
        return {
          success: true,
          documentType: 'purchase-order',
          data: poData,
        };
      }

      return { success: false, error: 'No table data found in document' };
    } catch (error: any) {
      if (attempt < MAX_RETRIES) {
        const { delay, reason } = computeRetryDelay(error, attempt);
        console.warn(
          `Attempt ${attempt + 1} of ${MAX_RETRIES + 1} failed for document "${file.name}". Error: ${error.message}. Retrying in ${delay}ms (using ${reason}).`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(
          `All ${MAX_RETRIES + 1} attempts to process document "${file.name}" failed. Last error:`,
          error
        );
        return { success: false, error: error.message, statusCode: error.statusCode };
      }
    }
  }

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
  data: PurchaseOrderData | InvoiceExcelData,
  documentType: DocumentType,
  fileName: string
): Promise<{ url: string; fileName: string }> => {
  const wb = XLSX.utils.book_new();
  const normalizedFileName = fileName.replace(/\.pdf$/i, '.xlsx');

  if (documentType === 'invoice') {
    const invoiceData = data as InvoiceExcelData;
    console.log(
      `Generating Excel for invoice with ${invoiceData.details.length} detail row(s) and ${invoiceData.lineItems.length} line item(s)`
    );

    const sanitizedDetails = invoiceData.details.map((detail, index) => {
      const sanitized = sanitizeRecordForExcel(detail);
      if (index < 3) {
        console.log(`Invoice detail row ${index}:`, sanitized);
      }
      return sanitized;
    });

    const sanitizedLineItems = invoiceData.lineItems.map((item, index) => {
      const sanitized = sanitizeRecordForExcel(item);
      if (index < 3) {
        console.log(`Invoice line item ${index}:`, sanitized);
      }
      return sanitized;
    });

    const detailColumns = new Set<string>();
    sanitizedDetails.forEach(row => Object.keys(row).forEach(key => detailColumns.add(key)));
    const lineItemColumns = new Set<string>();
    sanitizedLineItems.forEach(row => Object.keys(row).forEach(key => lineItemColumns.add(key)));

    console.log(
      `Invoice detail columns (${detailColumns.size}): ${Array.from(detailColumns).sort().join(', ')}`
    );
    console.log(
      `Invoice line item columns (${lineItemColumns.size}): ${Array.from(lineItemColumns).sort().join(', ')}`
    );

    const detailsSheet = XLSX.utils.json_to_sheet(sanitizedDetails.length ? sanitizedDetails : [{}]);
    const lineItemsSheet = XLSX.utils.json_to_sheet(sanitizedLineItems.length ? sanitizedLineItems : [{}]);

    XLSX.utils.book_append_sheet(wb, detailsSheet, 'Invoice Details');
    XLSX.utils.book_append_sheet(wb, lineItemsSheet, 'Line Items');
  } else {
    const poData = data as PurchaseOrderData;
    console.log(`Generating Excel for ${poData.items.length} purchase order item(s)`);

    const sanitizedItems = poData.items.map((item, index) => {
      const sanitizedItem = sanitizeRecordForExcel(item as Record<string, any>);
      if (index < 3) {
        console.log(`Item ${index} columns:`, Object.keys(sanitizedItem));
        console.log(`Item ${index} sample data:`, sanitizedItem);
      }
      return sanitizedItem;
    });

    const allColumns = new Set<string>();
    sanitizedItems.forEach(item => {
      Object.keys(item).forEach(key => allColumns.add(key));
    });
    console.log(`Total unique columns: ${allColumns.size}`, Array.from(allColumns).sort());

    const standardColumns = ['pu_quant', 'pu_price', 'pr_codenum', 'total'];
    const foundStandardColumns = standardColumns.filter(col => allColumns.has(col));
    console.log(`Found standard columns: ${foundStandardColumns.join(', ')}`);

    const itemsWs = XLSX.utils.json_to_sheet(sanitizedItems);
    XLSX.utils.book_append_sheet(wb, itemsWs, 'Line Items');
  }

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const url = URL.createObjectURL(blob);
  console.log(`Excel file created: ${normalizedFileName}`);
  return { url, fileName: normalizedFileName };
};


// This is a mock service that would be replaced with actual Azure Form Recognizer integration
// In a real application, these functions would make API calls to Azure services

// Define types for the extracted data
export interface InvoiceData {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  vendor?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  items?: InvoiceItem[];
}

export interface InvoiceItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  productCode?: string;
}

export interface PurchaseOrderData {
  poNumber?: string;
  poDate?: string;
  vendor?: string;
  total?: number;
  items?: POItem[];
}

export interface POItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  productCode?: string;
}

export interface ProcessingResult {
  success: boolean;
  data?: InvoiceData | PurchaseOrderData;
  error?: string;
}

// Mock function to analyze documents with Azure Form Recognizer
export const analyzeDocument = async (
  file: File,
  documentType: string,
): Promise<ProcessingResult> => {
  return new Promise((resolve) => {
    // Simulate processing delay
    setTimeout(() => {
      // Mock successful processing
      if (documentType === 'invoice') {
        const mockInvoiceData: InvoiceData = {
          invoiceNumber: 'INV-' + Math.floor(Math.random() * 10000),
          invoiceDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          vendor: 'Example Vendor Inc.',
          total: Math.round(Math.random() * 10000) / 100,
          subtotal: Math.round(Math.random() * 9000) / 100,
          tax: Math.round(Math.random() * 1000) / 100,
          items: [
            {
              description: 'Product A',
              quantity: Math.floor(Math.random() * 10) + 1,
              unitPrice: Math.round(Math.random() * 100) / 100,
              amount: Math.round(Math.random() * 500) / 100,
              productCode: 'P12-345-678',
            },
            {
              description: 'Service B',
              quantity: Math.floor(Math.random() * 5) + 1,
              unitPrice: Math.round(Math.random() * 200) / 100,
              amount: Math.round(Math.random() * 800) / 100,
              productCode: 'P22-456-789',
            },
          ],
        };
        resolve({
          success: true,
          data: mockInvoiceData,
        });
      } else {
        const mockPOData: PurchaseOrderData = {
          poNumber: 'PO-' + Math.floor(Math.random() * 10000),
          poDate: new Date().toISOString().slice(0, 10),
          vendor: 'Example Supplier Co.',
          total: Math.round(Math.random() * 10000) / 100,
          items: [
            {
              description: 'Component X',
              quantity: Math.floor(Math.random() * 100) + 1,
              unitPrice: Math.round(Math.random() * 50) / 100,
              amount: Math.round(Math.random() * 2000) / 100,
              productCode: 'P34-567-890',
            },
            {
              description: 'Component Y',
              quantity: Math.floor(Math.random() * 50) + 1,
              unitPrice: Math.round(Math.random() * 75) / 100,
              amount: Math.round(Math.random() * 3000) / 100,
              productCode: 'P45-678-901',
            },
          ],
        };
        resolve({
          success: true,
          data: mockPOData,
        });
      }
    }, 2000);
  });
};

// Mock function to split multi-page PDFs
export const splitPdf = async (file: File): Promise<File[]> => {
  return new Promise((resolve) => {
    // In a real app, we would use a PDF library to split the file
    // For now, just return the original file as if it's been split
    setTimeout(() => {
      resolve([file]);
    }, 1000);
  });
};

// Mock function to generate Excel output
export const generateExcelOutput = async (
  data: InvoiceData | PurchaseOrderData,
  documentType: string,
): Promise<string> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // In a real app, this would create an Excel file and return a download URL
      // For now, just return a mock URL
      resolve(`/api/download/${documentType}-${Date.now()}.xlsx`);
    }, 1000);
  });
};

// Mock function to pull prices from a database
export const pullPrices = async (): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // In a real app, this would query a database or service for price data
      resolve();
    }, 1500);
  });
};

// Mock function for batch cleaning
export const batchClean = async (): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // In a real app, this would perform batch cleaning operations
      resolve();
    }, 1500);
  });
};

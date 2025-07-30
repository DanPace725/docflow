import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import Index from '../Index'; // Adjust path as necessary
import { toast } from 'sonner';

import { vi } from 'vitest';

// Mock services
vi.mock('@/services/document-processor', () => ({
  analyzeDocument: vi.fn(),
  splitPdf: vi.fn(),
  generateExcelOutput: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Helper to access mocked functions
const { analyzeDocument, splitPdf, generateExcelOutput } = await vi.importMock('@/services/document-processor');
const { toast: mockedToast } = await vi.importMock('sonner');


describe('Index Page - handleProcess', () => {
  beforeEach(() => {
    // Clear mocks before each test
    vi.clearAllMocks();
  });

  test('should aggregate data from multiple pages and generate a single Excel file for invoices', async () => {
    const user = userEvent.setup();
    render(<Index />);
    
    // 1. GIVEN: A user has selected "Invoice" and uploaded a file
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Invoice' }));

    const fileInput = screen.getByTestId('file-input');
    const mockFile = new File(['dummy content'], 'multi-page-invoice.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, mockFile);

    // 2. WHEN: The processing is triggered for a multi-page invoice
    const page1 = { name: 'multi-page-invoice_1.pdf' };
    const page2 = { name: 'multi-page-invoice_2.pdf' };
    splitPdf.mockResolvedValue([page1, page2]);

    analyzeDocument
      .mockResolvedValueOnce({ // Page 1
        success: true,
        data: {
          details: { InvoiceId: 'INV-123', VendorName: 'Test Vendor' },
          items: [{ Description: 'Item A', Amount: 100 }]
        }
      })
      .mockResolvedValueOnce({ // Page 2
        success: true,
        data: {
          details: {}, // Details on 2nd page are ignored
          items: [{ Description: 'Item B', Amount: 200 }]
        }
      });
    
    generateExcelOutput.mockResolvedValue({ url: 'mock-url', fileName: 'final.xlsx' });

    const processButton = screen.getByRole('button', { name: /Process Files/i });
    await user.click(processButton);

    // 3. THEN: A single, consolidated Excel file is generated with the correct data
    await waitFor(() => {
      expect(generateExcelOutput).toHaveBeenCalledTimes(1);
    });

    const expectedConsolidatedData = {
      details: { InvoiceId: 'INV-123', VendorName: 'Test Vendor' },
      items: [
        { Description: 'Item A', Amount: 100 },
        { Description: 'Item B', Amount: 200 }
      ]
    };
    expect(generateExcelOutput).toHaveBeenCalledWith(
      expect.objectContaining(expectedConsolidatedData),
      'invoice',
      'multi-page-invoice.pdf'
    );

    await waitFor(() => {
      expect(mockedToast.success).toHaveBeenCalledWith(
        "Processing complete",
        expect.any(Object)
      );
    });
  });
});

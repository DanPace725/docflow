import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Index from '../Index'; // Adjust path as necessary
import { toast } from 'sonner';

// Mock services
jest.mock('@/services/document-processor', () => ({
  analyzeDocument: jest.fn(),
  splitPdf: jest.fn(),
  generateExcelOutput: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
  },
}));

// Helper to access mocked functions
const mockedAnalyzeDocument = jest.requireMock('@/services/document-processor').analyzeDocument;
const mockedSplitPdf = jest.requireMock('@/services/document-processor').splitPdf;
const mockedGenerateExcelOutput = jest.requireMock('@/services/document-processor').generateExcelOutput;
const mockedToastError = jest.requireMock('sonner').toast.error;

describe('Index Page - handleProcess', () => {
  beforeEach(() => {
    // Clear mocks before each test
    mockedAnalyzeDocument.mockClear();
    mockedSplitPdf.mockClear();
    mockedGenerateExcelOutput.mockClear();
    mockedToastError.mockClear();
  });

  test('should handle analyzeDocument failure for a page correctly', async () => {
    render(<Index />);

    // 1. Given: The user has dropped a single PDF file.
    // Simulate file drop (simplified for this test - actual FileDropzone might need more interaction)
    const fileInput = screen.getByTestId('file-input'); // Assuming FileDropzone has a testable input or a way to simulate drop
    const mockFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });
    
    await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument();
    });

    // 2. When:
    //  - The `splitPdf` service is mocked to return one mock PDF page.
    const mockPage = { name: 'test_page_1.pdf', arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)) };
    mockedSplitPdf.mockResolvedValue([mockPage]);

    //  - The `analyzeDocument` service is mocked to return `{ success: false, error: 'No table data found' }` for that page.
    mockedAnalyzeDocument.mockResolvedValue({ success: false, error: 'No table data found' });
    
    //  - The `generateExcelOutput` service is mocked (it should not be called - this is asserted later).
    //  - The user clicks the "Process Files" button.
    const processButton = screen.getByRole('button', { name: /Process Files/i });
    fireEvent.click(processButton);

    // 3. Then:
    await waitFor(() => {
      //  - The application should not crash (test will fail if it does).
      //  - A toast error message should be displayed to the user.
      expect(mockedToastError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process page: test_page_1.pdf. Error: No table data found')
      );
    });
    
    await waitFor(() => {
        expect(mockedToastError).toHaveBeenCalledWith(
            "Processing completed with errors",
            expect.objectContaining({
                description: expect.stringContaining("Processed 1 file(s) with 1 page(s) having errors.\nDetails:\nFailed to process page: test_page_1.pdf. Error: No table data found\n")
            })
        );
    });

    //  - The `generateExcelOutput` function should NOT have been called.
    expect(mockedGenerateExcelOutput).not.toHaveBeenCalled();

    //  - The overall status message should indicate that processing completed, but with errors.
    // The ProcessStatus component displays this message.
    // We check for part of the message due to potential dynamic updates.
    expect(screen.getByText(/Processed 1 file\(s\) with 1 page\(s\) having errors./i)).toBeInTheDocument();
    
    // Also check the final toast that summarizes the errors
     await waitFor(() => {
        expect(mockedToastError).toHaveBeenCalledWith(
            "Processing completed with errors",
            expect.objectContaining({
                description: expect.stringContaining("Processed 1 file(s) with 1 page(s) having errors.")
            })
        );
    });
  });
});

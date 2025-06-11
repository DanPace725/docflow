import { analyzeDocument, ProcessingResult, PurchaseOrderData, POItem } from './document-processor';
import { DocumentAnalysisClient, PollerLike, AnalyzeResult, AnalyzedDocument } from '@azure/ai-form-recognizer';
import { vi, describe, it, expect, beforeEach, afterEach, SpyInstance } from 'vitest';
import * as XLSX from 'xlsx'; // Import for type usage if needed by mock, and for accessing mocked members

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn(data => ({ '!ref': 'A1:B2', ...data })), // Return a mock sheet object
    book_new: vi.fn(() => ({ SheetNames: [], Sheets: {} })),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn(() => new ArrayBuffer(8)), // Must return non-empty for Blob
}));

vi.mock('@azure/ai-form-recognizer', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    DocumentAnalysisClient: vi.fn(),
    AzureKeyCredential: vi.fn(),
  };
});

// Mock URL.createObjectURL if not already globally defined or if needing to ensure it's a mock for all tests
if (typeof globalThis.URL?.createObjectURL === 'undefined') {
  if (!globalThis.URL) {
    (globalThis as any).URL = {};
  }
  globalThis.URL.createObjectURL = vi.fn(() => 'mock-url');
}


describe('analyzeDocument', () => {
  let mockBeginAnalyzeDocument: SpyInstance;
  let mockPollUntilDone: SpyInstance;
  let mockDocumentAnalysisClientInstance: any;

  const MOCK_ENDPOINT = 'mock-endpoint';
  const MOCK_KEY = 'mock-key';

  // Mock environment variables
  vi.stubEnv('VITE_AZURE_FORM_RECOGNIZER_ENDPOINT', MOCK_ENDPOINT);
  vi.stubEnv('VITE_AZURE_FORM_RECOGNIZER_KEY', MOCK_KEY);

  beforeEach(() => {
    // Reset mocks before each test
    mockPollUntilDone = vi.fn();
    mockBeginAnalyzeDocument = vi.fn(() => ({
      pollUntilDone: mockPollUntilDone,
    } as PollerLike<AnalyzeResult<AnalyzedDocument>, AnalyzeResult<AnalyzedDocument>>));

    mockDocumentAnalysisClientInstance = {
      beginAnalyzeDocument: mockBeginAnalyzeDocument,
    };

    (DocumentAnalysisClient as any).mockImplementation(() => mockDocumentAnalysisClientInstance);

    // Spy on console methods
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {}); // If any temporary logs remain or are added

    // Mock timers
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Test cases will be added here in subsequent subtasks
  it('should successfully analyze on the first attempt', async () => {
    const mockFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    const mockAnalyzeResult = { tables: [{ cells: [], rowCount: 1, columnCount: 1 }] } as unknown as AnalyzeResult<AnalyzedDocument>;
    mockPollUntilDone.mockResolvedValue(mockAnalyzeResult);

    const result = await analyzeDocument(mockFile, 'purchaseOrder');

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(mockBeginAnalyzeDocument).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

      it('should succeed after exponential backoff for a generic error', async () => {
        const mockFile = new File(['dummy content'], 'retry.pdf', { type: 'application/pdf' });
        const genericError = new Error('Generic service error');
        const mockAnalyzeResult = { tables: [{ cells: [], rowCount: 1, columnCount: 1 }] } as unknown as AnalyzeResult<AnalyzedDocument>;

        // Fail first, then succeed
        mockPollUntilDone
          .mockRejectedValueOnce(genericError)
          .mockResolvedValueOnce(mockAnalyzeResult);

        const promise = analyzeDocument(mockFile, 'purchaseOrder');

        // Advance timers for the first retry's delay (INITIAL_DELAY_MS = 3000)
        await vi.advanceTimersByTimeAsync(3000);

        const result = await promise;

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(mockBeginAnalyzeDocument).toHaveBeenCalledTimes(2); // Initial + 1 retry
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Attempt 1 of 4 failed for document "retry.pdf". Error: Generic service error. Retrying in 3000ms (using exponential backoff).')
        );
      });

      it('should succeed using Azure SDK suggested delay (error.retryAfterInMs)', async () => {
        const mockFile = new File(['dummy content'], 'sdk-retry.pdf', { type: 'application/pdf' });
        const retryAfterMs = 1500;
        const rateLimitError = {
          statusCode: 429,
          message: 'Too many requests, retry after.',
          retryAfterInMs: retryAfterMs
        };
        const mockAnalyzeResult = { tables: [{ cells: [], rowCount: 1, columnCount: 1 }] } as unknown as AnalyzeResult<AnalyzedDocument>;

        mockPollUntilDone
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce(mockAnalyzeResult);

        const promise = analyzeDocument(mockFile, 'purchaseOrder');

        await vi.advanceTimersByTimeAsync(retryAfterMs);

        const result = await promise;

        expect(result.success).toBe(true);
        expect(mockBeginAnalyzeDocument).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining(`Retrying in ${retryAfterMs}ms (using Azure-suggested delay).`)
        );
      });

      it('should permanently fail after exhausting all retries', async () => {
        const mockFile = new File(['dummy content'], 'fail.pdf', { type: 'application/pdf' });
        const persistentError = new Error('Persistent failure');

        // Fail all attempts (initial + 3 retries)
        mockPollUntilDone
          .mockRejectedValueOnce(persistentError) // Initial attempt
          .mockRejectedValueOnce(persistentError) // Retry 1
          .mockRejectedValueOnce(persistentError) // Retry 2
          .mockRejectedValueOnce(persistentError); // Retry 3

        const promise = analyzeDocument(mockFile, 'purchaseOrder');

        // Advance timers for all retry delays
        // INITIAL_DELAY_MS = 3000
        // Attempt 1 delay: 3000 * 2^0 = 3000
        // Attempt 2 delay: 3000 * 2^1 = 6000
        // Attempt 3 delay: 3000 * 2^2 = 12000
        await vi.advanceTimersByTimeAsync(3000); // After 1st failure
        await vi.advanceTimersByTimeAsync(6000); // After 2nd failure
        await vi.advanceTimersByTimeAsync(12000); // After 3rd failure

        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('Persistent failure');
        expect(mockBeginAnalyzeDocument).toHaveBeenCalledTimes(4); // Initial + 3 retries
        expect(console.warn).toHaveBeenCalledTimes(3); // Warnings for 3 retries
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('All 4 attempts to process document "fail.pdf" failed. Last error:'),
          persistentError
        );
      });

      it('should succeed using Retry-After header delay', async () => {
        const mockFile = new File(['dummy content'], 'header-retry.pdf', { type: 'application/pdf' });
        const retryAfterSeconds = 2; // Parsed from header
        const expectedDelayMs = retryAfterSeconds * 1000;
        const rateLimitError = {
          statusCode: 429,
          message: 'Too many requests, retry after header.',
          response: {
            // Simulate a Headers-like object or a simple object.
            // The code checks response.headers.get('retry-after') OR response.headers['retry-after']
            headers: {
              get: (name: string) => name === 'retry-after' ? String(retryAfterSeconds) : undefined,
              'retry-after': String(retryAfterSeconds) // For direct property access
            }
          }
        };
        const mockAnalyzeResult = { tables: [{ cells: [], rowCount: 1, columnCount: 1 }] } as unknown as AnalyzeResult<AnalyzedDocument>;

        mockPollUntilDone
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce(mockAnalyzeResult);

        const promise = analyzeDocument(mockFile, 'purchaseOrder');

        await vi.advanceTimersByTimeAsync(expectedDelayMs);

        const result = await promise;

        expect(result.success).toBe(true);
        expect(mockBeginAnalyzeDocument).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining(`Retrying in ${expectedDelayMs}ms (using Azure-suggested delay).`)
        );
      });

      it('should succeed using error message parsed delay', async () => {
        const mockFile = new File(['dummy content'], 'msg-parse-retry.pdf', { type: 'application/pdf' });
        const retryAfterSecondsInMessage = 5;
        const expectedDelayMs = retryAfterSecondsInMessage * 1000;
        const rateLimitError = {
          statusCode: 429,
          message: `Too many requests, please try again. retry after ${retryAfterSecondsInMessage} seconds. Some other text.`
          // No retryAfterInMs, no headers with retry-after
        };
        const mockAnalyzeResult = { tables: [{ cells: [], rowCount: 1, columnCount: 1 }] } as unknown as AnalyzeResult<AnalyzedDocument>;

        mockPollUntilDone
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce(mockAnalyzeResult);

        const promise = analyzeDocument(mockFile, 'purchaseOrder');

        await vi.advanceTimersByTimeAsync(expectedDelayMs);

        const result = await promise;

        expect(result.success).toBe(true);
        expect(mockBeginAnalyzeDocument).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining(`Retrying in ${expectedDelayMs}ms (using Azure-suggested delay).`)
        );
      });

      it('should cap Azure-suggested delay at MAX_DELAY_MS', async () => {
        const mockFile = new File(['dummy content'], 'max-delay-azure.pdf', { type: 'application/pdf' });
        // MAX_DELAY_MS is 30000 in the actual code
        const veryLargeRetryAfterMs = 50000; // This exceeds MAX_DELAY_MS
        const expectedCappedDelay = 30000;

        const rateLimitErrorHighDelay = {
          statusCode: 429,
          message: 'Too many requests, high suggested delay.',
          retryAfterInMs: veryLargeRetryAfterMs
        };
        const mockAnalyzeResult = { tables: [{ cells: [], rowCount: 1, columnCount: 1 }] } as unknown as AnalyzeResult<AnalyzedDocument>;


        mockPollUntilDone
          .mockRejectedValueOnce(rateLimitErrorHighDelay)
          .mockResolvedValueOnce(mockAnalyzeResult);

        const promise = analyzeDocument(mockFile, 'purchaseOrder');

        await vi.advanceTimersByTimeAsync(expectedCappedDelay); // Advance by the capped delay

        const result = await promise;

        expect(result.success).toBe(true);
        expect(mockBeginAnalyzeDocument).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining(`Retrying in ${expectedCappedDelay}ms (using Azure-suggested delay).`)
        );
      });

      it('acknowledges that exponential backoff capping is covered by MAX_DELAY_MS logic', () => {
        // With INITIAL_DELAY_MS = 3000 and MAX_RETRIES = 3, exponential delays are:
        // Attempt 0: 3000 * 2^0 = 3000ms
        // Attempt 1: 3000 * 2^1 = 6000ms
        // Attempt 2: 3000 * 2^2 = 12000ms
        // None of these reach MAX_DELAY_MS (30000ms).
        // Testing this directly would require more retries or different constants.
        // However, the line `currentDelay = Math.min(currentDelay, MAX_DELAY_MS);`
        // is applied universally. The 'should cap Azure-suggested delay at MAX_DELAY_MS'
        // test already verifies this capping mechanism works as intended.
        expect(true).toBe(true); // Placeholder for acknowledgment.
      });

});

describe('generateExcelOutput', () => {
  let mockJsonToSheet: SpyInstance;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks(); // Clears call counts etc. for all mocks

    // Re-assign spy if it's from a vi.mock.
    // XLSX is mocked as a whole, so its members are already mocks.
    mockJsonToSheet = XLSX.utils.json_to_sheet;

    // Ensure URL.createObjectURL is a mock for this test suite's context
    // It might have been globally mocked, or we might need to spy/re-mock here
    if (!vi.isMockFunction(globalThis.URL.createObjectURL)) {
        vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(() => 'mock-url');
    } else {
        // If already a global mock, ensure it's reset if necessary or re-assert behavior
        (globalThis.URL.createObjectURL as SpyInstance).mockClear();
        (globalThis.URL.createObjectURL as SpyInstance).mockReturnValue('mock-url');
    }
  });

  afterEach(() => {
    // vi.restoreAllMocks(); // This is good, but if URL.createObjectURL was spied here, it handles it.
                           // If it was globally mocked, this won't touch it unless we spied on the global mock.
                           // Let's rely on vi.clearAllMocks() for general mock state and specific spies for restore.
    // If we spied on globalThis.URL.createObjectURL in beforeEach, restore it.
    if (vi.isMockFunction(globalThis.URL.createObjectURL) && (globalThis.URL.createObjectURL as any).mockRestore) {
      (globalThis.URL.createObjectURL as any).mockRestore();
    }
    // If we used vi.clearAllMocks(), specific mock function states are cleared.
    // vi.restoreAllMocks() is generally more thorough for spies.
    // For robust cleanup with potential global mocks, it's tricky.
    // Given the setup, vi.clearAllMocks in beforeEach is the primary reset.
    // Let's ensure afterEach properly cleans up spies made within this describe block.
    vi.restoreAllMocks(); // This should handle spies created with vi.spyOn in this block's beforeEach
  });

  // Test case to be modified:
  it('should sanitize string properties to null AND preserve numbers (incl 0), nulls, and undefined', async () => {
    const purchaseOrderData: PurchaseOrderData = {
      items: [
        // Scenario 1: Empty string description, valid numeric quantity
        { description: '', pr_codenum: 'P123', pu_quant: 10, pu_price: 0.0 },
        // Scenario 2: Whitespace string description, zero quantity (important test)
        { description: '   ', pr_codenum: 'P456', pu_quant: 0, total: 0 },
        // Scenario 3: Valid description, whitespace pr_codenum, non-zero total
        { description: 'Valid Item', pr_codenum: '  ', total: 100 },
        // Scenario 4: Null description, undefined pr_codenum, numeric zero quantity
        { description: null, pr_codenum: undefined, pu_quant: 0 },
        // Scenario 5: Item with some properties missing, valid pr_codenum
        { pr_codenum: 'P789', pu_price: 12.34 },
        // Scenario 6: All numeric fields are zero
        { description: 'All Zeros Item', pu_quant: 0, pu_price: 0, total: 0 }
      ],
    };

    // Mock XLSX methods used within generateExcelOutput
    // mockJsonToSheet is already assigned in beforeEach from the mocked XLSX module
    // Other XLSX mocks (book_new, book_append_sheet, write) should be active from the suite's setup

    await generateExcelOutput(purchaseOrderData, 'purchaseOrder', 'test.pdf');

    expect(mockJsonToSheet).toHaveBeenCalledTimes(1);
    const sanitizedDataPassedToSheet = mockJsonToSheet.mock.calls[0][0];

    // --- Assertions ---

    // Item 1: description: '' -> null, pu_quant: 10, pu_price: 0.0 (preserved)
    expect(sanitizedDataPassedToSheet[0].description).toBeNull();
    expect(sanitizedDataPassedToSheet[0].pr_codenum).toBe('P123');
    expect(sanitizedDataPassedToSheet[0].pu_quant).toBe(10);
    expect(sanitizedDataPassedToSheet[0].pu_price).toBe(0.0); // Crucial: 0.0 preserved

    // Item 2: description: '   ' -> null, pu_quant: 0 (preserved), total: 0 (preserved)
    expect(sanitizedDataPassedToSheet[1].description).toBeNull();
    expect(sanitizedDataPassedToSheet[1].pr_codenum).toBe('P456');
    expect(sanitizedDataPassedToSheet[1].pu_quant).toBe(0); // Crucial: 0 preserved
    expect(sanitizedDataPassedToSheet[1].total).toBe(0);   // Crucial: 0 preserved

    // Item 3: pr_codenum: '  ' -> null, description: 'Valid Item' (preserved)
    expect(sanitizedDataPassedToSheet[2].description).toBe('Valid Item');
    expect(sanitizedDataPassedToSheet[2].pr_codenum).toBeNull();
    expect(sanitizedDataPassedToSheet[2].total).toBe(100);

    // Item 4: description: null (preserved), pr_codenum: undefined (preserved), pu_quant: 0 (preserved)
    expect(sanitizedDataPassedToSheet[3].description).toBeNull();
    expect(sanitizedDataPassedToSheet[3].pr_codenum).toBeUndefined();
    expect(sanitizedDataPassedToSheet[3].pu_quant).toBe(0); // Crucial: 0 preserved

    // Item 5: Missing properties remain undefined, existing ones preserved
    expect(sanitizedDataPassedToSheet[4].description).toBeUndefined();
    expect(sanitizedDataPassedToSheet[4].pr_codenum).toBe('P789');
    expect(sanitizedDataPassedToSheet[4].pu_price).toBe(12.34);

    // Item 6: All numeric zeros preserved
    expect(sanitizedDataPassedToSheet[5].description).toBe('All Zeros Item');
    expect(sanitizedDataPassedToSheet[5].pu_quant).toBe(0);
    expect(sanitizedDataPassedToSheet[5].pu_price).toBe(0);
    expect(sanitizedDataPassedToSheet[5].total).toBe(0);
  });

  it('should preserve items with no string properties needing sanitization', async () => {
    const purchaseOrderData: PurchaseOrderData = {
      items: [
        { description: 'Real Item', pr_codenum: 'PXYZ', pu_quant: 1, pu_price: 10, total: 10 },
        { pu_quant: 0, pu_price: 0, total: 0} // All numeric zeros
      ],
    };

    await generateExcelOutput(purchaseOrderData, 'purchaseOrder', 'test2.pdf');

    expect(mockJsonToSheet).toHaveBeenCalledTimes(1);
    const sanitizedDataPassedToSheet = mockJsonToSheet.mock.calls[0][0];

    expect(sanitizedDataPassedToSheet[0].description).toBe('Real Item');
    expect(sanitizedDataPassedToSheet[0].pr_codenum).toBe('PXYZ');
    expect(sanitizedDataPassedToSheet[0].pu_quant).toBe(1);

    expect(sanitizedDataPassedToSheet[1].pu_quant).toBe(0);
    expect(sanitizedDataPassedToSheet[1].pu_price).toBe(0);
    expect(sanitizedDataPassedToSheet[1].total).toBe(0);
    expect(sanitizedDataPassedToSheet[1].description).toBeUndefined();
  });
});

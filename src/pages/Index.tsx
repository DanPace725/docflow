
import React, { useState } from 'react';
import { toast } from 'sonner';

import Header from '@/components/header';
import FileDropzone from '@/components/file-dropzone';
import SettingsPanel from '@/components/settings-panel';
import ProcessStatus from '@/components/process-status';
import ActionButtons from '@/components/action-buttons';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';


import { 
  analyzeDocument,
  splitPdf,
  generateExcelOutput,
  //pullPrices as pullPricesService,
  //batchClean as batchCleanService
} from '@/services/document-processor';

const Index: React.FC = () => {
  // State for files and settings
  const [files, setFiles] = useState<File[]>([]);
  const [documentType, setDocumentType] = useState<string>('purchase-order');
  const [multiPage, setMultiPage] = useState<boolean>(false);
  const [downloadUrls, setDownloadUrls] = useState<Array<{ url: string; fileName: string }>>([]);
  
  // Processing state
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('Ready to process files');
  const [progress, setProgress] = useState<number>(0);
  
  // Processing logic
  const handleProcess = async () => {
    if (files.length === 0) {
      toast.error("No files to process");
      return;
    }

    setStatus('processing');
    setStatusMessage('Preparing files for processing...');
    setProgress(10);

    let overallErrorMessage = "";
    const failedPages: File[] = [];

    try {
      let totalPages = 0;
      let processedPages = 0;

      // First, get a total count of all pages to be processed
      for (const file of files) {
        const pages = await splitPdf(file);
        totalPages += pages.length;
      }

      // Main processing loop
      let interRequestDelay = 1000; // Start with a 1s delay
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatusMessage(`Processing file ${i + 1} of ${files.length}: ${file.name}`);
        
        const pages = await splitPdf(file);

        for (const page of pages) {
          processedPages++;
          setProgress(Math.round((processedPages / totalPages) * 80) + 10);

          // Don't wait before the very first request
          if (processedPages > 1) {
            setStatusMessage(`Waiting ${interRequestDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, interRequestDelay));
          }

          setStatusMessage(`Analyzing page ${page.name} (${processedPages}/${totalPages})`);
          
          const result = await analyzeDocument(page, documentType);
          
          if (result.success && result.data) {
            const { url, fileName: excelFileName } = await generateExcelOutput(result.data, page.name);
            setDownloadUrls(prevUrls => [...prevUrls, { url, fileName: excelFileName }]);
            const link = document.createElement('a');
            link.href = url;
            link.download = excelFileName;
            link.click();
          } else {
            const errorMessage = `Initial processing failed for page: ${page.name}. Error: ${result.error || 'Unknown'}`;
            toast.error(errorMessage);
            overallErrorMessage += `${errorMessage}\n`;
            failedPages.push(page); // Add to retry queue

            if (result.statusCode === 429) {
              interRequestDelay = Math.min(interRequestDelay * 2, 30000);
              toast.warning(`Rate limit hit. Delay increased to ${interRequestDelay}ms.`);
            }
          }
        }
      }

      // Retry loop for failed pages
      let finalErrorCount = 0;
      if (failedPages.length > 0) {
        setStatusMessage(`Retrying ${failedPages.length} failed page(s)...`);
        setProgress(90);

        const retryDelay = 5000; // Use a generous static delay for retries

        for (const page of failedPages) {
          setStatusMessage(`Waiting ${retryDelay}ms before retrying ${page.name}...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));

          setStatusMessage(`Retrying page: ${page.name}`);
          const result = await analyzeDocument(page, documentType);

          if (result.success && result.data) {
            toast.success(`Successfully processed ${page.name} on retry.`);
            const { url, fileName: excelFileName } = await generateExcelOutput(result.data, page.name);
            setDownloadUrls(prevUrls => [...prevUrls, { url, fileName: excelFileName }]);
            const link = document.createElement('a');
            link.href = url;
            link.download = excelFileName;
            link.click();
          } else {
            finalErrorCount++;
            const finalErrorMessage = `Permanent failure for page: ${page.name}. Error: ${result.error || 'Unknown'}`;
            toast.error(finalErrorMessage, { duration: 10000 });
            overallErrorMessage += `${finalErrorMessage}\n`;
          }
        }
      }
      
      setProgress(100);
      if (finalErrorCount > 0) {
        setStatus('error');
        const finalMessage = `Processing complete. ${files.length} file(s) processed with ${finalErrorCount} permanent error(s).`;
        setStatusMessage(finalMessage);
        toast.error("Processing completed with permanent errors", {
          description: `Details:\n${overallErrorMessage}`,
          duration: 15000
        });
      } else {
        setStatus('success');
        setStatusMessage(`Successfully processed all pages from ${files.length} file(s).`);
        toast.success("Processing complete", {
          description: `All pages from ${files.length} file(s) were processed successfully.`,
        });
      }
      
    } catch (error) {
      setStatus('error');
      const unexpectedErrorMessage = `An unexpected error stopped the process: ${error instanceof Error ? error.message : 'Unknown error'}`;
      setStatusMessage(unexpectedErrorMessage);
      toast.error("Critical Processing Error", {
        description: unexpectedErrorMessage,
      });
    }
  };

  // Action handlers
  const handleImport = () => {
    // In a real app, this might open a file browser dialog
    // Here we'll just focus on the dropzone
    document.getElementById('file-input')?.click();
  };

  const handleViewOutput = () => {
    // In a real app, this would open the output folder
    // Here we'll just show a toast
    toast.info("View Output", {
      description: "In a production environment, this would open the output folder.",
    });
  };

  const handlePullPrices = async () => {
  //   setStatus('processing');
  //   setStatusMessage('Pulling prices from database...');
  //   setProgress(50);
  //   
  //   try {
  //     await pullPricesService();
  //     setStatus('success');
  //     setStatusMessage('Price data successfully updated');
  //     toast.success("Prices Updated", {
  //       description: "Successfully pulled and updated price data",
  //     });
  //   } catch (error) {
  //     setStatus('error');
  //     setStatusMessage(`Error pulling prices: ${error instanceof Error ? error.message : 'Unknown error'}`);
  //     toast.error("Error", {
  //       description: "Failed to pull price data",
  //     });
  //   }
   };

  const handleBatchClean = async () => {
  //   setStatus('processing');
  //   setStatusMessage('Running batch clean process...');
  //   setProgress(50);
  //   
  //   try {
  //     await batchCleanService();
  //     setStatus('success');
  //     setStatusMessage('Batch clean completed successfully');
  //     toast.success("Batch Clean", {
  //       description: "Successfully completed batch clean process",
  //     });
  //   } catch (error) {
  //     setStatus('error');
  //     setStatusMessage(`Error during batch clean: ${error instanceof Error ? error.message : 'Unknown error'}`);
  //     toast.error("Error", {
  //       description: "Failed to complete batch clean process",
  //     });
  //   }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      
      <main className="flex-1 container py-8">
        <h1 className="text-2xl font-bold mb-6">Document Processing Center</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-800 mb-4">Upload Documents</h2>
                  <FileDropzone files={files} setFiles={setFiles} />
                </div>
              </CardContent>
            </Card>
            
            <ProcessStatus 
              status={status} 
              message={statusMessage} 
              progress={progress} 
            />
            
            <ActionButtons 
              onImport={handleImport}
              onProcess={handleProcess}
              onViewOutput={handleViewOutput}
              onPullPrices={handlePullPrices}
              onBatchClean={handleBatchClean}
              isProcessing={status === 'processing'}
              hasFiles={files.length > 0}
            />
          </div>
          
          <div className="space-y-6">
            <SettingsPanel 
              documentType={documentType}
              setDocumentType={setDocumentType}
              multiPage={multiPage}
              setMultiPage={setMultiPage}
            />
            {/* Add the download history card here */}
            {downloadUrls.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Generated Files</h2>
              <div className="space-y-2">
                {downloadUrls.map((file, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {file.fileName}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = file.url;
                        link.download = file.fileName;
                        link.click();
                      }}
                    >
                      Download Excel
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
            
            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Recent Activity</h2>
                {status === 'idle' && (
                  <p className="text-sm text-gray-500">No recent activity</p>
                )}
                {(status === 'success' || status === 'error') && (
                  <div className="text-sm">
                    <p className={`${status === 'success' ? 'text-green-600' : 'text-red-600'} font-medium`}>
                      {statusMessage}
                    </p>
                    <p className="text-gray-500 mt-1 text-xs">
                      {new Date().toLocaleString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      
      <footer className="bg-white border-t py-4">
        <div className="container mx-auto text-center text-sm text-gray-500">
          <p>&copy; {new Date().getFullYear()} DocFlow Automaton • PDF Processing Solution</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;

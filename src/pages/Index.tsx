
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
    let pagesWithErrors = 0;
    let overallErrorMessage = "";

    try {
      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        setStatusMessage(`Processing file ${i + 1} of ${files.length}: ${file.name}`);
        setProgress(Math.round((i / files.length) * 70) + 10);
        
        // Split PDF into pages if needed
        const pages = await splitPdf(file);
        
        // Process each page with a dynamic delay
        let interRequestDelay = 1000; // Start with a 1-second delay

        for (let j = 0; j < pages.length; j++) {
          // Don't wait before the very first request
          if (i > 0 || j > 0) {
            setStatusMessage(`Waiting ${interRequestDelay}ms to avoid rate limit...`);
            await new Promise(resolve => setTimeout(resolve, interRequestDelay));
          }

          const page = pages[j];
          setStatusMessage(`Analyzing page ${j + 1} of ${pages.length} from file ${i + 1}`);
          
          // Analyze the document
          const result = await analyzeDocument(page, documentType);
          
          if (result.success && result.data) {
            const { url, fileName: excelFileName } = await generateExcelOutput(result.data, documentType, page.name);
            setDownloadUrls(prevUrls => [...prevUrls, { url, fileName: excelFileName }]);
            
            // Create and click link for download
            const link = document.createElement('a');
            link.href = url;
            link.download = excelFileName;
            link.click();
          } else {
            pagesWithErrors++;
            const errorMessage = `Failed to process page: ${page.name}. Error: ${result.error || 'No data found'}`;
            toast.error(errorMessage);
            overallErrorMessage += `${errorMessage}\n`;

            // If we hit a rate limit, increase the delay for subsequent requests
            if (result.statusCode === 429) {
              interRequestDelay = Math.min(interRequestDelay * 2, 30000); // Double delay up to 30s
              toast.warning(`Rate limit hit. Increasing delay to ${interRequestDelay}ms.`);
            }
          }
        }
      }
      
      setProgress(100);
      if (pagesWithErrors > 0) {
        setStatus('error');
        const finalMessage = `Processed ${files.length} file(s) with ${pagesWithErrors} page(s) having errors.`;
        setStatusMessage(finalMessage);
        toast.error("Processing completed with errors", {
          description: `${finalMessage}\nDetails:\n${overallErrorMessage}`,
        });
      } else {
        setStatus('success');
        setStatusMessage(`Successfully processed ${files.length} file(s)`);
        toast.success("Processing complete", {
          description: `Successfully processed ${files.length} files`,
        });
      }
      
    } catch (error) {
      // This catch block will now primarily handle unexpected errors, 
      // rather than errors from analyzeDocument which are handled above.
      setStatus('error');
      const unexpectedErrorMessage = `Unexpected error during processing: ${error instanceof Error ? error.message : 'Unknown error'}`;
      setStatusMessage(unexpectedErrorMessage);
      toast.error("Processing error", {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
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

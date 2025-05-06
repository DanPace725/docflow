
import React, { useCallback } from 'react';
import { FileUp, Check, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FileDropzoneProps {
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ files, setFiles }) => {
  const { toast } = useToast();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      // Filter for PDF files only
      const pdfFiles = acceptedFiles.filter((file) => file.type === 'application/pdf');
      
      if (pdfFiles.length !== acceptedFiles.length) {
        toast({
          title: "Non-PDF files detected",
          description: "Only PDF files are accepted. Non-PDF files have been removed.",
          variant: "destructive",
        });
      }

      if (pdfFiles.length > 0) {
        setFiles((prevFiles) => [...prevFiles, ...pdfFiles]);
        toast({
          title: "Files uploaded",
          description: `${pdfFiles.length} PDF file(s) have been added.`,
        });
      }
    },
    [setFiles, toast]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFiles = Array.from(e.dataTransfer.files);
    onDrop(droppedFiles);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      onDrop(selectedFiles);
    }
  };

  const removeFile = (indexToRemove: number) => {
    setFiles((prevFiles) => prevFiles.filter((_, index) => index !== indexToRemove));
    toast({
      title: "File removed",
      description: "The selected file has been removed.",
    });
  };

  return (
    <div className="w-full space-y-4">
      <div 
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:bg-gray-50 transition-colors cursor-pointer"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input 
          id="file-input" 
          type="file" 
          multiple 
          accept=".pdf" 
          className="hidden" 
          onChange={handleFileInputChange}
        />
        <FileUp className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-2 text-sm text-gray-600">
          Drag and drop PDF files here, or click to select files
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF files only
        </p>
      </div>

      {files.length > 0 && (
        <div className="bg-white rounded-md shadow overflow-hidden">
          <div className="py-3 px-4 bg-gray-50 border-b">
            <h3 className="text-sm font-medium text-gray-700">Selected Files</h3>
          </div>
          <ul className="divide-y divide-gray-200 max-h-60 overflow-y-auto">
            {files.map((file, index) => (
              <li key={index} className="px-4 py-3 flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <Check size={16} className="text-green-500 mr-2" />
                  <span className="truncate">{file.name}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  className="text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FileDropzone;

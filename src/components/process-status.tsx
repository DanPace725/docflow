
import React from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface ProcessStatusProps {
  status: 'idle' | 'processing' | 'success' | 'error';
  message: string;
  progress?: number;
}

const ProcessStatus: React.FC<ProcessStatusProps> = ({ status, message, progress = 0 }) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">Processing Status</h2>
        {status === 'processing' && (
          <div className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full animate-pulse">
            In Progress
          </div>
        )}
        {status === 'success' && (
          <div className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
            Complete
          </div>
        )}
        {status === 'error' && (
          <div className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">
            Error
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3">
        {status === 'idle' && (
          <div className="text-gray-500 text-sm">{message}</div>
        )}

        {status === 'processing' && (
          <>
            <Loader2 className="animate-spin text-blue-500" size={20} />
            <div>
              <div className="text-sm font-medium">{message}</div>
              <Progress value={progress} className="h-1 mt-2" />
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="text-green-500" size={20} />
            <div className="text-sm font-medium">{message}</div>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="text-red-500" size={20} />
            <div className="text-sm font-medium">{message}</div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProcessStatus;

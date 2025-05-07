
import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface ActionButtonsProps {
  onImport: () => void;
  onProcess: () => void;
  onViewOutput: () => void;
  onPullPrices: () => void;
  onBatchClean: () => void;
  isProcessing: boolean;
  hasFiles: boolean;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({
  onImport,
  onProcess,
  onViewOutput,
  //onPullPrices,
  //onBatchClean,
  isProcessing,
  hasFiles,
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Button 
          variant="outline" 
          onClick={onImport}
          disabled={isProcessing}
        >
          Import Files
        </Button>
        
        <Button 
          onClick={onProcess} 
          disabled={!hasFiles || isProcessing}
          className="bg-primary hover:bg-primary/90"
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            'Process Files'
          )}
        </Button>
        
        <Button 
          variant="secondary" 
          onClick={onViewOutput}
          disabled={isProcessing}
        >
          View Output
        </Button>
        
        <Button 
          variant="outline" 
          //onClick={onPullPrices}
          disabled={isProcessing}
        >
          Pull Prices
        </Button>
        
        <Button 
          variant="outline" 
          //onClick={onBatchClean}
          disabled={isProcessing}
        >
          Batch Clean
        </Button>
      </div>
    </div>
  );
};

export default ActionButtons;

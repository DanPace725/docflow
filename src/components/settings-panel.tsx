
import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface SettingsPanelProps {
  documentType: string;
  setDocumentType: React.Dispatch<React.SetStateAction<string>>;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  documentType, 
  setDocumentType
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-5 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Processing Settings</h2>
      
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="document-type">Document Type</Label>
          <Select value={documentType} onValueChange={setDocumentType}>
            <SelectTrigger id="document-type" className="w-full">
              <SelectValue placeholder="Select document type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="purchase-order">Purchase Order</SelectItem>
              <SelectItem value="invoice">Invoice</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Select the type of document to process. The system will automatically handle multiple pages.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;


import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface SettingsPanelProps {
  documentType: string;
  setDocumentType: React.Dispatch<React.SetStateAction<string>>;
  multiPage: boolean;
  setMultiPage: React.Dispatch<React.SetStateAction<boolean>>;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  documentType, 
  setDocumentType, 
  multiPage, 
  setMultiPage 
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
            Select the type of document you are processing
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="multi-page" className="cursor-pointer">
            Multi-page {documentType === "invoice" ? "Invoice" : "Document"}
          </Label>
          <Switch
            id="multi-page"
            checked={multiPage}
            onCheckedChange={setMultiPage}
          />
        </div>

        <div className="pt-2">
          <p className="text-sm text-gray-600">
            {multiPage 
              ? "The system will process all pages as a single document and aggregate the data." 
              : "Each page will be processed as an individual document."}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

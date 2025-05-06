#PDF_Proc.py
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QPushButton, QVBoxLayout, QWidget, QCheckBox,
    QFileDialog, QLabel, QMessageBox, QGridLayout, QDesktopWidget, QComboBox, QHBoxLayout, QSpacerItem, QSizePolicy,
)
from PyQt5.QtCore import pyqtSlot, QThread, pyqtSignal, Qt
from PyQt5.QtGui import QIcon
import sys
import os
import shutil
import pandas as pd
from PyPDF2 import PdfReader, PdfWriter
from azure.ai.formrecognizer import DocumentAnalysisClient, DocumentField
from azure.core.credentials import AzureKeyCredential
import re
import win32com.client
import importlib
from datetime import datetime
date = datetime.now().strftime("%m-%d_%H_%M")




# Azure credentials and paths

base_path = "D:/Work/"
doc_path = ""
paths = {'input': 'Input/', 'processed': 'Processed/', 'output': 'Output/', 'archive_input': 'Input/Archive/', 'archive_processed': 'Processed/Archive/'}

# Worker thread
class WorkerThread(QThread):
    finished = pyqtSignal()
    progress = pyqtSignal(int)
    def __init__(self, func, *args, **kwargs):
        """
        Initializes a new instance of the class.

        Args:
            func (callable): The function to be called.
            *args: Variable length argument list.
            **kwargs: Arbitrary keyword arguments.

        Returns:
            None
        """
        super().__init__()
        self.func = func
        self.args = args
        self.kwargs = kwargs

    def run(self):
        self.func(*self.args, **self.kwargs)
        self.finished.emit()
        
# Main Application Window
class PDFProcessingApp(QMainWindow):
    def __init__(self):
        """
        Initializes the class instance.
        """
        super().__init__()
        self.initUI()
        self.runningThreads = []

    def initUI(self):
        """
        Initializes the user interface for the PDF processing app.

        This function sets the window title, geometry, and centers the window on the screen.
        It also creates a central widget to hold other widgets and sets its layout.
        The function adds a status label, a progress bar, and buttons to the layout.

        Parameters:
        - self: The instance of the class.

        Returns:
        - None
        """
        self.setWindowIcon(QIcon('icons\\appIcon.png'))
        self.setWindowTitle('PDF Processing App')
        self.setGeometry(300, 300, 500, 300)  # Increase window size for better layout
        self.center()

        # Create a central widget to hold other widgets
        self.centralWidget = QWidget(self)
        self.setCentralWidget(self.centralWidget)

        # Create and set layout for the central widget
        layout = QVBoxLayout(self.centralWidget)  # Use QVBoxLayout for vertical arrangement

        # Create a top layout for status and document type
        topLayout = QHBoxLayout()

        # Dropdown for selecting document type
        self.docTypeComboBox = QComboBox(self)
        self.docTypeComboBox.addItems(['Purchase Order', 'Invoice'])
        self.docTypeComboBox.setFixedWidth(150)  # Set a fixed width for the combo box
        topLayout.addWidget(self.docTypeComboBox)

        
        # Add spacer to push status label to the right
        spacer = QSpacerItem(20, 20, QSizePolicy.Expanding, QSizePolicy.Minimum)
        topLayout.addItem(spacer)

        self.multiPageCheckbox = QCheckBox("Multi-page Invoice", self)
        layout.addWidget(self.multiPageCheckbox)  # Add the checkbox to the main layout

        self.statusLabel = QLabel('Status: Ready', self)
        self.statusLabel.setStyleSheet("QLabel { color: green; font-weight: bold; }")  # Add styling to status label
        topLayout.addWidget(self.statusLabel)

        layout.addLayout(topLayout)  # Add top layout to the main layout

        # Create a grid layout for buttons
        buttonLayout = QGridLayout()

        

        self.importButton = QPushButton('Import Files', self)
        self.importButton.clicked.connect(self.importFiles)
        buttonLayout.addWidget(self.importButton, 0, 0)

        self.processButton = QPushButton('Process Files', self)
        self.processButton.clicked.connect(self.processFiles)
        buttonLayout.addWidget(self.processButton, 0, 1)

        # Create a new button for Invoice Output
        self.invoiceOutputButton = QPushButton('Invoice Output', self)
        self.invoiceOutputButton.clicked.connect(self.openInvoiceOutputFolder)
        buttonLayout.addWidget(self.invoiceOutputButton, 0, 2) 

        self.pullPricesButton = QPushButton('Pull Prices', self)
        self.pullPricesButton.clicked.connect(self.pullPrices)
        buttonLayout.addWidget(self.pullPricesButton, 1, 1)

        self.runVbaButton = QPushButton('Batch Clean', self)
        self.runVbaButton.clicked.connect(self.runVbaMacro)
        buttonLayout.addWidget(self.runVbaButton, 1, 0)

        layout.addLayout(buttonLayout)  # Add button layout to the main layout

        # Add spacer to push exit button to the bottom
        spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
        layout.addItem(spacer)

        self.exitButton = QPushButton('Exit', self)
        self.exitButton.clicked.connect(QApplication.instance().quit)
        layout.addWidget(self.exitButton, alignment=Qt.AlignRight)  # Align exit button to the right

    def center(self):
        qr = self.frameGeometry()
        cp = QDesktopWidget().availableGeometry().center()
        qr.moveCenter(cp)
        self.move(qr.topLeft())
    @pyqtSlot()
    def importFiles(self):
        """
        Import files using a file dialog.

        This function opens a file dialog to allow the user to select one or more PDF files.
        The selected files are stored as an instance variable.

        Parameters:
        - None

        Returns:
        - None
        """
        # File import logic goes here
        options = QFileDialog.Options()
        default_dir = "C:/Users/daniel.pace/Documents/Coding/PO Automation/Azure/Purchase Orders/Start"  # Set the default directory
        files, _ = QFileDialog.getOpenFileNames(self, "Choose a PDF file", default_dir, "PDF Files (*.pdf)", options=options)
        if files:
            self.files = files  # Store the files as an instance variable
            self.statusLabel.setText(f'Status: Files Imported{files}')
    @pyqtSlot()
    def processFiles(self):
        # Set endpoint and key based on document type selection
        doc_type = self.docTypeComboBox.currentText()
        if doc_type == 'Invoice':
            endpoint = "https://phh-invoices.cognitiveservices.azure.com/"
            doc_path = base_path + "Invoices/"
            key = os.getenv("AZURE_API_KEY_PHH-INVOICES")
        else:  # Purchase Order
            endpoint = "https://pos.cognitiveservices.azure.com/"
            key = os.getenv("AZURE_API_KEY_POS")
            doc_path = base_path + "Purchase Orders/"

        paths = {
            'input': doc_path + 'Input/', 
            'processed': doc_path + 'Processed/', 
            'output': doc_path + 'Output/', 
            'archive_input': doc_path + 'Input/Archive/', 
            'archive_processed': doc_path + 'Processed/Archive/'
        }
        
        # Create the credential and client with the selected endpoint and key
        credential = AzureKeyCredential(key)
        self.client = DocumentAnalysisClient(endpoint=endpoint, credential=credential)

        if hasattr(self, 'files') and self.files:
            self.processButton.setEnabled(False)
            self.statusLabel.setText('Status: Processing...')
            
            multi_page = self.multiPageCheckbox.isChecked()  # Check the state of the checkbox
            self.worker = WorkerThread(self.processPDFs, self.files, paths, multi_page)
            self.worker.finished.connect(self.onProcessingComplete)
            self.worker.start()
            self.runningThreads.append(self.worker)  # Keep track of the thread
        else:
            QMessageBox.warning(self, 'Warning', 'No files have been imported.')

    @pyqtSlot()
    def openInvoiceOutputFolder(self):
        """
        Opens the Invoice Output folder in the file explorer.
        """
        import subprocess
        folder_path = r"C:\Users\daniel.pace\Documents\Coding\PO Automation\Azure\Invoices\Output"
        subprocess.Popen(f'explorer "{folder_path}"')

    def onWorkerFinished(self, worker):
        self.runningThreads.remove(worker)  


    def processPDFs(self, files, paths, multi_page):
        """
        Process a list of PDF files based on the document type.

        Args:
            files (list): A list of file paths to the PDF files.
            paths (dict): A dictionary containing the paths for input, processed, output, and archive directories.

        Returns:
            None
        """
        doc_type = self.docTypeComboBox.currentText()

        for file_path in files:
            # Extract filename for use in paths
            filename = os.path.basename(file_path)

            # Step 1: Copy file to the 'input' directory
            shutil.copy(file_path, os.path.join(paths['input'], filename))

            # Step 2: Split PDF
            # Note: split_pdf now takes a single file path, not a directory
            self.split_pdf(os.path.join(paths['input'], filename), paths)

            # Step 3: Analyze documents based on the document type
            if doc_type == 'Invoice':
                self.process_invoices(paths, multi_page)
            elif doc_type == 'Purchase Order':
                self.analyze_general_documents(paths)

            # Step 4: Move original file to 'archive_input'
            shutil.move(os.path.join(paths['input'], filename), os.path.join(paths['archive_input'], filename))

            # Note: Moving processed files to 'archive_processed' should be handled within the respective processing functions

    
    @pyqtSlot()
    def onProcessingComplete(self):
        self.processButton.setEnabled(True)
        self.statusLabel.setText('Status: Complete')
        QMessageBox.information(self, 'Complete', 'Files have been processed.')
        # Assuming you know which thread called this, you can remove it from the list:
        self.runningThreads.remove(self.worker)
        self.worker = None  # Remove reference to the worker


    def split_pdf(self, file_path, paths):
        """
        Splits a PDF file into multiple pages.

        Parameters:
            file_path (str): The path to the PDF file to be split.
            paths (dict): A dictionary containing the paths for processed files.

        Returns:
            None
        """
        # Ensure the path points to a file
        if not file_path.endswith(".pdf"):
            print(f"Error: {file_path} is not a PDF file.")
            return

        # Initialize PdfReader with the provided file path
        pdf = PdfReader(file_path)
        for i, page in enumerate(pdf.pages):
            pdf_writer = PdfWriter()
            pdf_writer.add_page(page)

            # Construct output filename for each page
            output_filename = f"{os.path.splitext(os.path.basename(file_path))[0]}_{i + 1}.pdf"
            output_filepath = os.path.join(paths['processed'], output_filename)

            # Write out each page as a separate PDF
            with open(output_filepath, 'wb') as out:
                pdf_writer.write(out)

    def extract_table_data(self, table):
        table_data = []
        row_data = []
        current_row_index = 0
        for cell in sorted(table.cells, key=lambda c: (c.row_index, c.column_index)):
            if cell.row_index != current_row_index:
                table_data.append(row_data)
                row_data = []
                current_row_index = cell.row_index
            row_data.append(cell.content)
        table_data.append(row_data)  # Append the last row
        return table_data
    
    def extract_invoice_data(self, file_path):
        """Extract invoice data using Azure Form Recognizer"""
        
        errors = []
        invoice_data = None
        
        try:
            with open(file_path, "rb") as fd:
                document = fd.read()

            poller = self.client.begin_analyze_document("prebuilt-invoice", document)  
            result = poller.result()
            
            invoice_data = result.documents[0].fields

        except Exception as e:
            errors.append(f"Error processing {file_path}: {e}")
            
        if errors:
            self.log_errors(errors)
            
        return invoice_data

    def invoice_dfs(self, invoice_data_list):
        """Convert extracted invoice data into DataFrames"""
        
        all_data_dfs = []
        line_items_dfs = []

        for invoice_data in invoice_data_list:
            
            all_data = {key: value.value if isinstance(value, DocumentField) else value
                        for key, value in invoice_data.items() if key != 'Items'}
                        
            all_data_df = pd.DataFrame([all_data])
            all_data_dfs.append(all_data_df)
                
            if 'Items' in invoice_data:
                line_items = []
                for item in invoice_data['Items'].value:
                    line_item = {key: value.value if isinstance(value, DocumentField) else value
                                for key, value in item.value.items()}
                    line_items.append(line_item)
                        
                line_items_df = pd.DataFrame(line_items)
                line_items_df.index = range(1, len(line_items_df) + 1)
                line_items_dfs.append(line_items_df)
            else:
                # If 'Items' key is not present, add an empty DataFrame
                line_items_dfs.append(pd.DataFrame())

        return all_data_dfs, line_items_dfs

    def process_invoices(self, paths, multi_page):
        files = [f for f in os.listdir(paths['processed']) if f.endswith(".pdf")]
        all_line_items_df = pd.DataFrame()
        for file in files:
            file_path = os.path.join(paths['processed'], file)
            
            invoice_data = self.extract_invoice_data(file_path)
            if invoice_data:
                all_data_dfs, line_items_dfs = self.invoice_dfs([invoice_data])

                for all_data_df, line_items_df in zip(all_data_dfs, line_items_dfs):
                    self.save_document_output(all_data_df, line_items_df, os.path.splitext(os.path.basename(file_path))[0], 'Invoice', paths)

                if multi_page:
                    # Aggregate line items across all files if multi-page is checked
                    all_line_items_df = pd.concat([all_line_items_df] + line_items_dfs, ignore_index=True)

        if multi_page:
            # Save aggregated line item data only if multi-page is checked
            self.save_aggregated_output(all_line_items_df, 'invoices', paths, os.path.splitext(os.path.basename(file_path))[0])

        # Move files to archive_processed
        for file in files:
            file_path = os.path.join(paths['processed'], file)
            shutil.move(file_path, os.path.join(paths['archive_processed'], file))


    def analyze_general_documents(self, paths):
        """
        Analyze general documents such as purchase orders.

        Args:
            paths (dict): A dictionary containing the paths for input, processed, output, and archive directories.
        """
        files = [f for f in os.listdir(paths['processed']) if f.endswith(".pdf")]
        
        for file in files:
            file_path = os.path.join(paths['processed'], file)
            with open(file_path, "rb") as fd:
                document = fd.read()
            poller = self.client.begin_analyze_document("prebuilt-document", document)
            result = poller.result()
            for i, table in enumerate(result.tables):
                df = pd.DataFrame(self.extract_table_data(table))
                df.columns = df.iloc[0]  # Use the first row as column headers
                df = df.drop(df.index[0])  # Drop the first row now that headers are set
                df = self.replace_import_headers(df)  # Optionally replace headers based on your logic
                df.to_excel(os.path.join(paths['output'], f"{os.path.splitext(file)[0]}_table_{i}.xlsx"), index=False)
            
            shutil.move(file_path, os.path.join(paths['archive_processed'], file))
    def move_to_archive(self, path, archive_path):
        for file in os.listdir(base_path + path):
            if os.path.isfile(base_path + path + file):
                shutil.move(base_path + path + file, base_path + archive_path + file)
    def replace_import_headers(self, df):
        try:
            
            df.columns = df.columns.astype(str).str.lower()

            # Check if any of the target words are present in the header row
            target_words = ["order", "items", "quantity", "qty", "cost", "unit price", "price", "#", "amount"]
            if not any(word in df.columns for word in target_words):
                return df  # Skip replacements if no target words are found

            # Initially handle 'amount' specifically
            if 'amount' in df.columns:
                index = df.columns.tolist().index('amount')
                if index == 0:
                    df.rename(columns={'amount': 'quantity'}, inplace=True)
                elif index == len(df.columns) - 1:
                    df.rename(columns={'amount': 'total'}, inplace=True)

            # Define replacements after handling 'amount'
            replacements = {k: v for k, v in zip(
                ["order", "items", "quantity", "qty", "cost", "unit price", "price", "#"], 
                ["pu_quant"] * 4 + ["pu_price"] * 4)}

            # Apply the replacements for other headers
            df.rename(columns={col: replacements.get(col, col) for col in df.columns}, inplace=True)

            # Part number identification and renaming
            part_number_column_index = None
            part_number_pattern = re.compile(r'P\d{2}-\d{3}-\d{3}')
            for index, column in enumerate(df.columns):
                # Check if any cell in the column matches the part number pattern
                if df[column].astype(str).str.match(part_number_pattern).any():
                    part_number_column_index = index
                    break

            if part_number_column_index is not None:
                # Directly set the column name in the DataFrame's columns attribute
                df.columns.values[part_number_column_index] = 'pr_codenum'

        except Exception as e:
            print(f"Error occurred while replacing import headers: {e}")
            # Optionally, log the error or handle it as per requirement
            return df  # Return the dataframe even if an error occurs to not interrupt the flow

        return df
    @pyqtSlot()
    def pullPrices(self):
        """
        Slot method to handle the 'Pull Prices' button click.
        """
        try:
            self.pullPricesFromExcel()
            QMessageBox.information(self, 'Success', 'Prices have been pulled successfully.')
        except Exception as e:
            QMessageBox.warning(self, 'Error', f'An error occurred: {e}')
    def pullPricesFromExcel(self):
        """
        Method to pull prices from Excel files in a folder and process them.

        Args:
        folder_path (str): Path to the folder containing Excel files.
        """
        folder_path = "P:/Temp"
        # Get a list of all Excel files in the folder
        excel_files = [f for f in os.listdir(folder_path) if f.endswith(".xlsx")]
        for file in excel_files:
            try:
                # Construct full path to the current file
                file_path = os.path.join(folder_path, file)

                # Read the current Excel file
                original_df = pd.read_excel(file_path, engine='openpyxl')

                # Load the LPC Excel file
                lpc_df = pd.read_excel(
                    r"C:\Users\daniel.pace\Documents\Coding\Purchasing Automation\PA_V4\Price Comparison\Last Part Cost 3.1.xlsx",
                    sheet_name='All')
                
                # Map PO Cost from LPC to original dataframe based on part numbers
                original_df = original_df.merge(lpc_df[['pr_codenum', 'PO Cost']], on='pr_codenum', how='left')

                # Save the processed data to a new file with the original filename
                original_df.to_excel(os.path.join(folder_path, f"processed_{file}"), index=False)
            except Exception as e:
                print(f"Error processing {file}: {e}")
                continue
    def runVbaMacro(self):
        excel = None  # Initialize excel variable to ensure it's in scope for the finally block
        try:
            excel = win32com.client.Dispatch('Excel.Application')  # Using late binding
            excel.Visible = True  # Set to False if you don't want Excel to be visible

            # Open PERSONAL workbook
            personal_wb_path = r"C:\Users\daniel.pace\AppData\Roaming\Microsoft\Excel\XLSTART\PERSONALwb.XLSB"
            personal_wb = excel.Workbooks.Open(personal_wb_path)

            # Load the add-in if it's not already loaded
            addin_path = r"C:\Users\daniel.pace\AppData\Roaming\Microsoft\AddIns\CustomMacros.xlam"
            if addin_path not in [x.FullName for x in excel.AddIns]:
                excel.Workbooks.Open(addin_path)

            # Run the macro
            macro_name = "CustomMacros.xlam!batchClean"  # Make sure the macro name is correct
            excel.Application.Run(macro_name)

        except Exception as e:
            QMessageBox.warning(self, 'Error', f'An error occurred while running the macro: {e}')
        finally:
            if excel is not None:
                personal_wb.Close(False)  # Close the PERSONAL workbook without saving changes
                excel.Quit()  # Close the Excel application
                del excel  # Ensure Excel process is terminated

        
    def save_document_output(self, all_data_df, line_items_df, file_name, doc_type, paths):
        output_dir = paths['output']
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        output_file_path = os.path.join(output_dir, f'{file_name}.xlsx')
        with pd.ExcelWriter(output_file_path, engine='xlsxwriter') as writer:
            all_data_df.to_excel(writer, sheet_name=f'{doc_type} Details', index=False)
            line_items_df.to_excel(writer, sheet_name='Line Items', index=True)  # Keeping index=True since you want the index to start from 1

    def save_aggregated_output(self, dataframe, data_type, paths, file_name):
        output_dir = paths['output']
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        output_file_path = os.path.join(output_dir, f'{file_name}_aggregated.xlsx')
        with pd.ExcelWriter(output_file_path, engine='xlsxwriter') as writer:
            dataframe.to_excel(writer, sheet_name=f'Aggregated {data_type.capitalize()}')

    def closeEvent(self, event):
        for worker in self.runningThreads:
            worker.wait()  # Wait for the thread to finish
        event.accept()  # Now it's safe to close

    


def main():
    app = QApplication(sys.argv)
    ex = PDFProcessingApp()
    ex.show()
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()

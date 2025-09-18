# Document Processing Automaton

This repository contains a powerful tool for extracting data from PDF documents like invoices and purchase orders, and converting it into structured Excel files. It includes two main components: a modern web application and a Python-based desktop GUI application.

## Features

### Web Application (Recommended)
-   **Modern UI**: A clean and intuitive user interface built with React and shadcn/ui.
-   **File Upload**: Drag-and-drop or browse to upload multiple PDF files.
-   **AI-Powered Data Extraction**: Uses Azure Form Recognizer to analyze documents and extract tabular data.
-   **PDF Processing**: Automatically splits multi-page PDFs into individual pages for processing.
-   **Intelligent Error Handling**: Includes robust retry logic and handles API rate limiting (429 errors) gracefully.
-   **Excel Export**: Converts the extracted data into `.xlsx` files, which are downloaded automatically.
-   **Secure**: API keys are handled securely on the client-side and are not exposed in the code.

### Python Desktop Application
-   **Desktop GUI**: A functional desktop application built with Python and PyQt5.
-   **Similar Core Functionality**: Also uses Azure Form Recognizer to process PDFs and export data to Excel.
-   **Additional Features**: Includes experimental or legacy features for pulling prices from external sheets and running VBA macros.
-   **Local File System**: Works directly with local folders for input and output.

---

## Technologies Used

-   **Frontend (Web App)**:
    -   [Vite](https://vitejs.dev/)
    -   [React](https://reactjs.org/)
    -   [TypeScript](https://www.typescriptlang.org/)
    -   [Tailwind CSS](https://tailwindcss.com/)
    -   [shadcn/ui](https://ui.shadcn.com/)
    -   [Azure AI SDK](https://azure.microsoft.com/en-us/products/ai-services/document-intelligence)

-   **Backend (Python App)**:
    -   [Python](https://www.python.org/)
    -   [PyQt5](https://riverbankcomputing.com/software/pyqt/)
    -   [Pandas](https://pandas.pydata.org/)
    -   [PyPDF2](https://pypdf2.readthedocs.io/)
    -   [Azure AI SDK](https://azure.microsoft.com/en-us/products/ai-services/document-intelligence)

---

## Setup & Usage

### Web Application

This is the recommended way to use the tool.

**1. Clone the repository:**
```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
```

**2. Install dependencies:**
```sh
npm install
```

**3. Configure Environment Variables:**

Create a file named `.env` in the root of the project and add your Azure Form Recognizer credentials:

```env
VITE_AZURE_FORM_RECOGNIZER_ENDPOINT="<YOUR_AZURE_ENDPOINT>"
VITE_AZURE_FORM_RECOGNIZER_KEY="<YOUR_AZURE_API_KEY>"
```

**4. Run the application:**
```sh
npm run dev
```
The application will be available at `http://localhost:5173` (or another port if 5173 is in use).

### Python Desktop Application

This application is also available but may not be as up-to-date as the web version.

**1. Install Python dependencies:**

It is recommended to use a virtual environment.

```sh
# It's good practice to create a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows, use `venv\Scripts\activate`

# Install required packages
pip install PyQt5 pandas PyPDF2 azure-ai-formrecognizer openpyxl
```
*Note: A `requirements.txt` file is not provided, so the list above is based on the imports in the script.*

**2. Configure Environment Variables:**

The Python script expects the following environment variables to be set:

-   `AZURE_API_KEY_PHH-INVOICES`: Your Azure API key for invoice processing.
-   `AZURE_API_KEY_POS`: Your Azure API key for purchase order processing.

You can set these in your operating system or use a library like `python-dotenv`.

**3. Run the application:**
```sh
python PDF_ProcV2.py
```
The application requires hardcoded file paths (e.g., `D:/Work/`) to be adjusted in the source code to match your system.

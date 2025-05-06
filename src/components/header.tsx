
import React from 'react';
import { FilePenLine } from 'lucide-react';

const Header = () => {
  return (
    <header className="bg-primary text-primary-foreground py-4 shadow-md">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <FilePenLine size={28} />
          <h1 className="text-xl font-semibold">DocFlow Automaton</h1>
        </div>
        <div className="text-sm">
          <span className="opacity-80">Document Processing Solution</span>
        </div>
      </div>
    </header>
  );
};

export default Header;

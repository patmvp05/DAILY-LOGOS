import fs from 'fs';
import path from 'path';

function fixColorsInDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fixColorsInDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const original = content;
      content = content.replace(/text-evernote/g, 'text-brand');
      content = content.replace(/bg-evernote/g, 'bg-brand');
      content = content.replace(/border-evernote/g, 'border-brand');
      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

fixColorsInDir(path.join(process.cwd(), 'src', 'components'));

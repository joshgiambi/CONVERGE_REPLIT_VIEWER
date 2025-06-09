import { uploadLimbicScan } from './limbic-uploader.js';

console.log('Starting LIMBIC upload debug...');

// Override console.log to capture upload progress
const originalLog = console.log;
console.log = (...args) => {
  const message = args.join(' ');
  if (message.includes('LIMBIC') || message.includes('Series:') || message.includes('files')) {
    originalLog('[DEBUG]', ...args);
  }
  originalLog(...args);
};

try {
  await uploadLimbicScan();
  console.log('LIMBIC upload completed');
} catch (error) {
  console.error('LIMBIC upload failed:', error);
}
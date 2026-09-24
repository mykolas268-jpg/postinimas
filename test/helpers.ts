import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPipelineConfig } from '../src/config.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pc = loadPipelineConfig(path.join(ROOT, 'config'));
export const config = pc.config;
export const fixtures = path.join(ROOT, 'test', 'fixtures');

import { pipeline, env } from '@xenova/transformers';
env.allowLocalModels = false;
console.log('Import OK');
// Just test import, don't download model yet
process.exit(0);

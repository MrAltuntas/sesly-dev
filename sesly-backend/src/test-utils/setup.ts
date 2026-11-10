import * as dotenv from 'dotenv';
import * as path from 'path';

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.test') });

// Set default test timeout
jest.setTimeout(15000);

// Global afterEach cleanup
afterEach(() => {
  jest.clearAllMocks();
});

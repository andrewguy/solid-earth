import fc from 'fast-check'

// FC_NUM_RUNS=5000 npm test  → more thorough property runs (default 100).
const numRuns = Number(process.env.FC_NUM_RUNS)
if (numRuns > 0) fc.configureGlobal({ numRuns })

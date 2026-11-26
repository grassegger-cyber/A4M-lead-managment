// Fills the local database with obviously fictional companies for trying the application out.
// Usage: npm run seed -- --count 10000 [--force]
// Runs on plain Node (type stripping), so it imports with relative paths and .ts extensions.
//
// The data itself comes from src/lib/server/seed-core.ts (shared with the demo build): names
// carry the word "Testovací" and a number, IČO come from the 99xxxxxx range, phone numbers use
// the non-existent prefix +420 000.
import { closeDb, dataDir, getDb } from '../src/lib/server/db.ts';
import { seedFictionalCompanies } from '../src/lib/server/seed-core.ts';

// ---------- arguments ----------
function parseArgs(argv: string[]): { count: number; force: boolean } {
	let count = 10000;
	let force = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--force') force = true;
		else if (argv[i] === '--count') count = Number(argv[++i]);
		else if (argv[i].startsWith('--count=')) count = Number(argv[i].slice(8));
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive whole number');
	return { count, force };
}

async function main() {
	const { count, force } = parseArgs(process.argv.slice(2));
	const started = Date.now();
	const db = await getDb();
	console.log(`Database: ${dataDir()}/pglite`);

	const existing = (await db.one<{ n: number }>('select count(*)::int as n from companies'))!.n;
	if (existing > 0 && !force) {
		console.error(
			`The database already holds ${existing} companies. Nothing was written.\n` +
				'Run with --force to add more fictional companies next to them.'
		);
		process.exitCode = 1;
		return;
	}

	const written = await seedFictionalCompanies(db, { count });
	console.log(
		`Written: ${written.companies} companies, ${written.phones} phones, ${written.history} history rows, ` +
			`${written.assignments} assignments, ${written.reps} sales reps, ${written.cohorts} cohorts.`
	);
	console.log('By state:', written.stateCounts);
	console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

main()
	.catch((e) => {
		console.error(e instanceof Error ? e.message : e);
		process.exitCode = 1;
	})
	.finally(() => closeDb());

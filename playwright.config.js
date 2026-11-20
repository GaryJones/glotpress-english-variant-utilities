import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: 'tests',
	forbidOnly: !! process.env.CI,
	use: {
		// Every request is mocked; make sure none can reach the real site.
		launchOptions: { args: [ '--host-resolver-rules=MAP * ~NOTFOUND' ] },
	},
} );

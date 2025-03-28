// just simple test to see if the nile sdk is working
import { Nile } from '@niledatabase/server';

const TEST_PASSWORD = 'TestPassword123!';
const TEST_USER = 'testRunner@thenile.dev';

(async () => {
    const nile = await Nile({
        debug: true,
    });

    // Expect this to set the token in SDK context
    try {
        const loginResponse = await nile.api.login({
            email: TEST_USER,
            password: TEST_PASSWORD,
        });
        console.log("Logged in");
    } catch (error) {
        console.error("Failed to login");
    }

    // create a new tenant
    const newTenant = await nile.api.tenants.createTenant({
        name: "My Company",
    });
    console.log(newTenant);

    // should list all tenants
    const tenantResponse = await nile.api.tenants.listTenants();
    console.log(tenantResponse);

    nile.tenantId = tenantResponse[0].id; // set the tenant context
    // expect to list users in the tenant
    const response = await nile.api.users.listUsers();
    console.log(response);
    console.log(nile.tenantId);
})().catch(console.error); // Add error handling


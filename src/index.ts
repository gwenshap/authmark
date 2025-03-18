import { Nile, Server } from '@niledatabase/server';
import { faker } from '@faker-js/faker';
import * as dotenv from 'dotenv';

dotenv.config();

// const TOTAL_USERS = 5_000_000;
const TOTAL_USERS = 100;
// const HOURLY_AUTH_USERS = 6000;
const HOURLY_AUTH_USERS = 100;
// const HOURS_TO_RUN = 24;
const HOURS_TO_RUN = 1;

interface User {
  email: string;
  password: string;
}

class UserGenerator {
  private users: User[] = [];
  private nile: Server | undefined;
  private readonly TEST_PASSWORD = 'TestPassword123!';
  private readonly TEST_USER = 'testRunner@thenile.dev';
  private tenantId: string | null = null;
  private readonly TENANT_NAME = 'Test Tenant';

  private async initNile() {
    this.nile = await Nile({
  //      debug: true,
    });
    console.log("Nile initialized");
  }

  private async ensureTestUser(): Promise<void> {
    if (!this.nile) {
      throw new Error('Nile client not initialized');
    }
    // Note that we don't need to handle the response from the login
    // Nile SDK will store the token in memory and reuse it for subsequent requests
    try {
      // Try to login first
      const loginResponse = await this.nile.api.login({
        email: this.TEST_USER,
        password: this.TEST_PASSWORD,
      })
      console.log('Logged in as test runner');
    } catch (error) {
      // If login fails, create the user and then login
      await this.nile.api.users.createUser({
        email: this.TEST_USER,
        password: this.TEST_PASSWORD,
      });
      await this.nile.api.login({
        email: this.TEST_USER,
        password: this.TEST_PASSWORD,
      });
      console.log('Created and logged in as test runner');
    }
  }

  private async ensureTenant(): Promise<void> {
    // List existing tenants
    if (!this.nile) {
      console.error('Nile client not initialized');
      process.exit(1);
    }
    const tenants = await this.nile.api.tenants.listTenants();
    console.log(tenants);
    const testTenant = tenants.find((t: any) => t.name.startsWith('Test Tenant'));
    
    if (testTenant) {
      this.tenantId = testTenant.id;
      this.nile.tenantId = this.tenantId;
      console.log(`Using existing tenant: ${testTenant.name} (${this.tenantId})`);
    } else {
      const response = await this.nile.api.tenants.createTenant({
        name: `Test Tenant ${Math.floor(Math.random() * 1000)}`
      });
      this.tenantId = response.id;
      this.nile.tenantId = this.tenantId; // this sets the tenant context for all subsequent requests
      console.log(`Created tenant ${response.name} with ID: ${this.tenantId}`);
    }
  }

  async generateUsers(count: number): Promise<boolean> {
    if (!this.nile) {
      console.error('Nile client not initialized');
      process.exit(1);
    }
    console.log(`Generating ${count} users...`);
    let successCount = 0;
    
    for (let i = 0; i < count; i++) {
      const email = faker.internet.email();
      try {
        // no need to pass tenantId, it's already set
        await this.nile.api.users.createTenantUser({
          email,
          password: this.TEST_PASSWORD,
        });
        
        this.users.push({ email, password: this.TEST_PASSWORD });
        successCount++;
        
        if (i % 1000 === 0) {
          console.log(`Generated ${i} users...`);
        }
      } catch (error) {
        console.error(`Error creating user ${i}:`, error);
      }
    }
    
    console.log(`User generation completed. Successfully created ${successCount}/${count} users`);
    return successCount === count;
  }

  async authenticateRandomUser() {
    const randomUser = this.users[Math.floor(Math.random() * this.users.length)];
    
    try {
      await this.nile.api.login({
        email: randomUser.email,
        password: randomUser.password,
      });
      console.log(`Authenticated user: ${randomUser.email}`);
    } catch (error) {
      console.error(`Error authenticating user:`, error);
    }
  }

  private async loadExistingUsers(): Promise<boolean> {
    if (!this.nile) {
      console.error('Nile client not initialized');
      process.exit(1);
    }
    console.log('Loading existing users from database for tenant', this.nile.tenantId);
    try {
      // Tenant ID is already set, so we don't need to pass it in
      const response = await this.nile.api.users.listUsers();
      this.users = response.map((user: any) => ({
        email: user.email,
        password: this.TEST_PASSWORD
      }));
      console.log(`Loaded ${this.users.length} existing users`);
      return this.users.length > 0;
    } catch (error) {
      console.error('Error loading existing users:', error);
      return false;
    }
  }

  async run(): Promise<void> {
    try {
      await this.initNile();
      if (!this.nile) {
        console.error('Nile client not initialized');
        process.exit(1);
      }
      await this.ensureTestUser();
      await this.ensureTenant();
      console.log('Ensured tenant:', this.tenantId);
      // Load existing users
      const usersLoaded = await this.loadExistingUsers();
      if (!usersLoaded) {
        console.error('Failed to load existing users');
        process.exit(1);
      }
      
      // Create additional users if needed
      if (this.users.length < TOTAL_USERS) {
        console.log(`Found ${this.users.length} users, creating ${TOTAL_USERS - this.users.length} more...`);
        const usersGenerated = await this.generateUsers(TOTAL_USERS - this.users.length);
        if (!usersGenerated) {
          console.error('Failed to generate all required users');
          process.exit(1);
        }
      }

      // Run test iterations
      await this.runTestIterations();
    } catch (error) {
      console.error('Fatal error during execution:', error);
      process.exit(1);
    }
  }

  async runTestIterations() {
    console.log('Starting hourly authentication cycle...');
    let hoursRun = 0;
    let authCount = 0;
    
    // Calculate delay between logins to distribute them across the hour
    const msPerHour = 3600000;
    const averageDelayBetweenLogins = msPerHour / HOURLY_AUTH_USERS;
    
    const processAuth = async () => {
      if (hoursRun >= HOURS_TO_RUN) {
        console.log('Completed authentication cycle');
        process.exit(0);
        return;
      }
      
      // Reset counter each hour
      if (authCount >= HOURLY_AUTH_USERS) {
        hoursRun++;
        authCount = 0;
        console.log(`Completed hour ${hoursRun}`);
        return;
      }
      
      await this.authenticateRandomUser();
      authCount++;
      
      // Add random variation to the delay (±50% of average delay)
      const randomFactor = 0.5 + Math.random();
      const nextDelay = averageDelayBetweenLogins * randomFactor;
      
      setTimeout(processAuth, nextDelay);
    };

    // Start the process
    processAuth();
  }
}

// Create and run the generator
const generator = new UserGenerator();
generator.run().catch(console.error); 
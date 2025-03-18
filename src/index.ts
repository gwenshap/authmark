import { Nile, Server } from '@niledatabase/server';
import { faker } from '@faker-js/faker';
import * as dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const TOTAL_USERS = 5_000_000;
const HOURLY_AUTH_USERS = 6000;
const HOURS_TO_RUN = 24;

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
  private readonly CHUNK_SIZE = 10;

  // Add decorator utility method
  private ensureNileInitialized() {
    if (!this.nile) {
      console.error('Nile client not initialized');
      process.exit(1);
    }
    return this.nile;
  }

  private async initNile() {
    this.nile = await Nile({
     //  debug: true,
    });
    console.log("Nile initialized");
  }

  private async ensureTestUser(): Promise<void> {
    const nile = this.ensureNileInitialized();
    try {
      // Try to login first
      const loginResponse = await nile.api.login({
        email: this.TEST_USER,
        password: this.TEST_PASSWORD,
      })
      console.log('Logged in as test runner');
    } catch (error) {
      // If login fails, create the user and then login
      await nile.api.users.createUser({
        email: this.TEST_USER,
        password: this.TEST_PASSWORD,
      });
      await nile.api.login({
        email: this.TEST_USER,
        password: this.TEST_PASSWORD,
      });
      console.log('Created and logged in as test runner');
    }
  }

  private async ensureTenant(): Promise<void> {
    const nile = this.ensureNileInitialized();
    // List existing tenants
    const tenants = await nile.api.tenants.listTenants();
    console.log(tenants);
    const testTenant = tenants.find((t: any) => t.name.startsWith('Test Tenant'));
    
    if (testTenant) {
      this.tenantId = testTenant.id;
      nile.tenantId = this.tenantId;
      console.log(`Using existing tenant: ${testTenant.name} (${this.tenantId})`);
    } else {
      const response = await nile.api.tenants.createTenant({
        name: `Test Tenant ${Math.floor(Math.random() * 1000)}`
      });
      this.tenantId = response.id;
      nile.tenantId = this.tenantId; // this sets the tenant context for all subsequent requests
      console.log(`Created tenant ${response.name} with ID: ${this.tenantId}`);
    }
  }

  private generateRandomEmail(): string {
    const randomId = Buffer.from(crypto.randomBytes(12)).toString('hex');
    return `user${randomId}@loadtest.nile.dev`;
  }

  async generateUsers(count: number): Promise<boolean> {
    const nile = this.ensureNileInitialized();
    console.log(`Generating ${count} users...`);
    let successCount = 0;
    let processedCount = 0;
    
    // Create a queue of users to process
    const userQueue = Array.from({ length: count }, () => ({
      email: this.generateRandomEmail(),
      password: this.TEST_PASSWORD
    }));

    // Process users in chunks
    while (userQueue.length > 0) {
      const chunk = userQueue.splice(0, this.CHUNK_SIZE);
      const promises = chunk.map((user) => 
        nile.api.users.createTenantUser({
          email: user.email,
          password: user.password,
        })
        .then(() => {
          this.users.push(user);
          successCount++;
        })
        .catch((error) => {
          console.error(`Error creating user with email ${user.email}:`, error);
        })
      );

      // Wait for the current chunk to complete
      await Promise.all(promises);
      processedCount += chunk.length;

      if (processedCount % 1000 === 0 || processedCount === count) {
        console.log(`Generated ${processedCount} users...`);
      }
    }
    
    console.log(`User generation completed. Successfully created ${successCount}/${count} users`);
    return successCount === count;
  }

  async authenticateRandomUser() {
    const nile = this.ensureNileInitialized();
    const randomUser = this.users[Math.floor(Math.random() * this.users.length)];
    
    try {
      await nile.api.login({
        email: randomUser.email,
        password: randomUser.password,
      });
      console.log(`Authenticated user: ${randomUser.email}`);
    } catch (error) {
      console.error(`Error authenticating user:`, error);
    }
  }

  private async loadExistingUsers(): Promise<boolean> {
    const nile = this.ensureNileInitialized();
    console.log('Loading existing users from database for tenant', nile.tenantId);
    try {
      // Tenant ID is already set, so we don't need to pass it in
      const response = await nile.api.users.listUsers();
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
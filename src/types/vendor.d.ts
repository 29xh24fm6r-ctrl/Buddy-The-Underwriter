// Type declarations for optional third-party dependencies
// These modules are only used in specific connect features and may not be installed

declare module "intuit-oauth" {
  class OAuthClient {
    constructor(config: any);
    authorizeUri(params: any): string;
    createToken(url: string): Promise<any>;
    getToken(): any;
    setToken(token: any): void;
    refresh(): Promise<any>;
    makeApiCall(options: any): Promise<any>;
    
    static scopes: {
      Accounting: string;
      Payment: string;
      Payroll: string;
      TimeTracking: string;
      Benefits: string;
      OpenId: string;
    };
  }
  
  export = OAuthClient;
}

declare module "fast-xml-parser";

declare module "plaid" {
  export class Configuration {
    constructor(config: any);
  }
  
  export class PlaidApi {
    constructor(config: Configuration);
    linkTokenCreate(request: any): Promise<any>;
    itemPublicTokenExchange(request: any): Promise<any>;
    accountsGet(request: any): Promise<any>;
    transactionsSync(request: any): Promise<any>;
    transactionsGet(request: any): Promise<any>;
  }
  
  export const PlaidEnvironments: {
    sandbox: string;
    development: string;
    production: string;
    [key: string]: string;
  };
  
  export enum Products {
    Transactions = "transactions",
    Auth = "auth",
    Identity = "identity",
    Assets = "assets",
  }
  
  export enum CountryCode {
    Us = "US",
    Ca = "CA",
    Gb = "GB",
  }
}


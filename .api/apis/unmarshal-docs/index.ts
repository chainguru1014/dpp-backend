import type * as types from './types';
import type { ConfigOptions, FetchResponse } from 'api/dist/core'
import Oas from 'oas';
import APICore from 'api/dist/core';
import definition from './openapi.json';

class SDK {
  spec: Oas;
  core: APICore;

  constructor() {
    this.spec = Oas.init(definition);
    this.core = new APICore(this.spec, 'unmarshal-docs/1.0 (api/6.1.2)');
  }

  /**
   * Optionally configure various options that the SDK allows.
   *
   * @param config Object of supported SDK options and toggles.
   * @param config.timeout Override the default `fetch` request timeout of 30 seconds. This number
   * should be represented in milliseconds.
   */
  config(config: ConfigOptions) {
    this.core.setConfig(config);
  }

  /**
   * If the API you're using requires authentication you can supply the required credentials
   * through this method and the library will magically determine how they should be used
   * within your API request.
   *
   * With the exception of OpenID and MutualTLS, it supports all forms of authentication
   * supported by the OpenAPI specification.
   *
   * @example <caption>HTTP Basic auth</caption>
   * sdk.auth('username', 'password');
   *
   * @example <caption>Bearer tokens (HTTP or OAuth 2)</caption>
   * sdk.auth('myBearerToken');
   *
   * @example <caption>API Keys</caption>
   * sdk.auth('myApiKey');
   *
   * @see {@link https://spec.openapis.org/oas/v3.0.3#fixed-fields-22}
   * @see {@link https://spec.openapis.org/oas/v3.1.0#fixed-fields-22}
   * @param values Your auth credentials for the API; can specify up to two strings or numbers.
   */
  auth(...values: string[] | number[]) {
    this.core.setAuth(...values);
    return this;
  }

  /**
   * If the API you're using offers alternate server URLs, and server variables, you can tell
   * the SDK which one to use with this method. To use it you can supply either one of the
   * server URLs that are contained within the OpenAPI definition (along with any server
   * variables), or you can pass it a fully qualified URL to use (that may or may not exist
   * within the OpenAPI definition).
   *
   * @example <caption>Server URL with server variables</caption>
   * sdk.server('https://{region}.api.example.com/{basePath}', {
   *   name: 'eu',
   *   basePath: 'v14',
   * });
   *
   * @example <caption>Fully qualified server URL</caption>
   * sdk.server('https://eu.api.example.com/v14');
   *
   * @param url Server URL
   * @param variables An object of variables to replace into the server URL.
   */
  server(url: string, variables = {}) {
    this.core.setServer(url, variables);
  }

  /**
   * Retrieve a comprehensive list of ERC20 token holdings for a specific address, including
   * the balance of native token. Our API provides real-time price information and token
   * details for enhanced visibility and analysis.
   *
   * @summary Fungible ERC20 Token Balances
   */
  fungibleErc20TokenBalances(metadata: types.FungibleErc20TokenBalancesMetadataParam): Promise<FetchResponse<200, types.FungibleErc20TokenBalancesResponse200>> {
    return this.core.fetch('/v1/{chain}/address/{address}/assets', 'get', metadata);
  }

  /**
   * Retrieve a comprehensive list of ERC20 token holdings for a specific address, including
   * the balance of native token. Our API provides real-time price information and token
   * details for enhanced visibility and analysis.
   *
   * V2 api returns paginated response
   *
   * @summary Fungible ERC20 Token Balances V2
   */
  getV2ChainAddressAddressAssets(metadata: types.GetV2ChainAddressAddressAssetsMetadataParam): Promise<FetchResponse<200, types.GetV2ChainAddressAddressAssetsResponse200>> {
    return this.core.fetch('/v2/{chain}/address/{address}/assets', 'get', metadata);
  }

  /**
   * The Profit/Loss API returns the net profit or loss made by a specified address for a
   * particular token.
   *
   * @summary Profit and Loss
   */
  getV2ChainAddressAddressUserData(metadata: types.GetV2ChainAddressAddressUserDataMetadataParam): Promise<FetchResponse<200, types.GetV2ChainAddressAddressUserDataResponse200>> {
    return this.core.fetch('/v2/{chain}/address/{address}/userData', 'get', metadata);
  }

  /**
   * This API is similar to the previous one for retrieving ERC20 token holdings for a
   * specific address. However, it also supports multiple chains and multiple wallet
   * addresses in a batch format. It provides real-time price information and token details
   * for comprehensive visibility and analysis.
   *
   * @summary Fungible ERC20 Token Balances - Batch
   */
  getV3BatchAssets(metadata: types.GetV3BatchAssetsMetadataParam): Promise<FetchResponse<200, types.GetV3BatchAssetsResponse200>> {
    return this.core.fetch('/v3/batch-assets', 'get', metadata);
  }

  /**
   * The NFT Assets API allows retrieval of all non-fungible ERC-721 and ERC-1155 NFT assets
   * held by an address with offset-based pagination.
   *
   * @summary Non Fungible Nft Token Balances
   */
  getV3ChainAddressAddressNftAssets(metadata: types.GetV3ChainAddressAddressNftAssetsMetadataParam): Promise<FetchResponse<200, types.GetV3ChainAddressAddressNftAssetsResponse200>> {
    return this.core.fetch('/v3/{chain}/address/{address}/nft-assets', 'get', metadata);
  }

  /**
   * The transaction History by Address API allows you to retrieve a list of all transactions
   * associated with a wallet address. The transactions are returned in reverse chronological
   * order, with the most recent transactions appearing first. Additionally, the API includes
   * decrypt log events in the response. \n Note: We support a maximum pageSize of 20 for the
   * Solana chain.
   *
   * @summary Transaction History for Address
   */
  getV3ChainAddressAddressTransactions(metadata: types.GetV3ChainAddressAddressTransactionsMetadataParam): Promise<FetchResponse<200, types.GetV3ChainAddressAddressTransactionsResponse200>> {
    return this.core.fetch('/v3/{chain}/address/{address}/transactions', 'get', metadata);
  }

  /**
   * This API returns total transactions count and total pages of a wallet address with
   * Prices included.
   *
   * @summary History by address with price
   */
  getV2ChainAddressAddressTransactions(metadata: types.GetV2ChainAddressAddressTransactionsMetadataParam): Promise<FetchResponse<200, types.GetV2ChainAddressAddressTransactionsResponse200>> {
    return this.core.fetch('/v2/{chain}/address/{address}/transactions', 'get', metadata);
  }

  /**
   * The API returns the total transactions count and pages of a wallet address without
   * prices.
   *
   * @summary History by Address with transaction count
   */
  getV1ChainAddressAddressTransactions(metadata: types.GetV1ChainAddressAddressTransactionsMetadataParam): Promise<FetchResponse<200, types.GetV1ChainAddressAddressTransactionsResponse200>> {
    return this.core.fetch('/v1/{chain}/address/{address}/transactions', 'get', metadata);
  }

  /**
   * This API provides all the transactions of a token address. \n Note: We support a maximum
   * pageSize of 20 for the Solana chain.
   *
   * @summary Token Transactions
   */
  getV2ChainTokenAddressTransactions(metadata: types.GetV2ChainTokenAddressTransactionsMetadataParam): Promise<FetchResponse<200, types.GetV2ChainTokenAddressTransactionsResponse200>> {
    return this.core.fetch('/v2/{chain}/token/{contract}/transactions', 'get', metadata);
  }

  /**
   * This API gives all the details for a specific transaction on a particular chain.
   *
   * @summary Transaction Details
   */
  getV1ChainTransactionsTransactionHash(metadata: types.GetV1ChainTransactionsTransactionHashMetadataParam): Promise<FetchResponse<200, types.GetV1ChainTransactionsTransactionHashResponse200>> {
    return this.core.fetch('/v1/{chain}/transactions/{transactionHash}', 'get', metadata);
  }

  /**
   * This API provides total transaction count and total pages for all token transactions.
   *
   * @summary Token Transactions with count
   */
  getV1ChainTokenAddressTransactions(metadata: types.GetV1ChainTokenAddressTransactionsMetadataParam): Promise<FetchResponse<200, types.GetV1ChainTokenAddressTransactionsResponse200>> {
    return this.core.fetch('/v1/{chain}/token/{contract}/transactions', 'get', metadata);
  }

  /**
   * This endpoint allows you to retrieve the transaction count for a given address.
   *
   * @summary Wallet Transaction Count
   */
  getV1ChainAddressAddressTransactionsCount(metadata: types.GetV1ChainAddressAddressTransactionsCountMetadataParam): Promise<FetchResponse<200, types.GetV1ChainAddressAddressTransactionsCountResponse200>> {
    return this.core.fetch('/v1/{chain}/address/{address}/transactions/count', 'get', metadata);
  }

  /**
   * The Top Holders API retrieves the list of the top token holders for a specific token on
   * the Ethereum and Polygon blockchains.
   *
   * @summary Top Token Holders
   */
  getV1ChainContractContractTopHolders(metadata: types.GetV1ChainContractContractTopHoldersMetadataParam): Promise<FetchResponse<200, types.GetV1ChainContractContractTopHoldersResponse200>> {
    return this.core.fetch('/v1/{chain}/contract/{contract}/top-holders', 'get', metadata);
  }

  /**
   * The Token Holders API enables the retrieval of the total number of token holders for a
   * specific token contract address.
   *
   * @summary Token Holders Count
   */
  getV1ChainTokenAddressAddressHoldersCount(metadata: types.GetV1ChainTokenAddressAddressHoldersCountMetadataParam): Promise<FetchResponse<200, types.GetV1ChainTokenAddressAddressHoldersCountResponse200>> {
    return this.core.fetch('/v1/{chain}/token-address/{contract}/holders-count', 'get', metadata);
  }

  /**
   * Provides detailed information about the token by contract address.
   *
   * @summary Token Details by Contract
   */
  getV1TokenstoreTokenAddressAddress(metadata: types.GetV1TokenstoreTokenAddressAddressMetadataParam): Promise<FetchResponse<200, types.GetV1TokenstoreTokenAddressAddressResponse200>> {
    return this.core.fetch('/v1/tokenstore/token/address/{address}', 'get', metadata);
  }

  /**
   * The API provides detailed information about the token by Token Symbol.
   *
   *
   * @summary Token Details by Symbol
   */
  getV1TokenstoreTokenSymbolSymbol(metadata: types.GetV1TokenstoreTokenSymbolSymbolMetadataParam): Promise<FetchResponse<200, types.GetV1TokenstoreTokenSymbolSymbolResponse200>> {
    return this.core.fetch('/v1/tokenstore/token/symbol/{symbol}', 'get', metadata);
  }

  /**
   * The API provides a list of all the tokens available in Ethereum, BSC, and Polygon
   *
   * @summary List of all Token
   */
  getV1TokenstoreTokenAll(metadata?: types.GetV1TokenstoreTokenAllMetadataParam): Promise<FetchResponse<200, types.GetV1TokenstoreTokenAllResponse200>> {
    return this.core.fetch('/v1/tokenstore/token/all', 'get', metadata);
  }

  /**
   * This API provides the price of the token by taking the symbol of the token(ticker) as a
   * parameter which will give the latest price.
   *
   * NOTE: This endpoint gives live prices for all coingecko supported symbols, however
   * historical prices are supported only for Ethereum, BSC, Matic and Arbitrum. Timestamp
   * can also be provided as a query param to get historical data.
   *
   * @summary Price by Symbol
   */
  getV1PricestoreSymbol(metadata: types.GetV1PricestoreSymbolMetadataParam): Promise<FetchResponse<200, types.GetV1PricestoreSymbolResponse200>> {
    return this.core.fetch('/v1/pricestore/{symbol}', 'get', metadata);
  }

  /**
   * This API provides the price of a token by the contract address of the token in any
   * chain.
   *
   * @summary Price by Address
   */
  getV1PricestoreChainPriceStoreChainsAddress(metadata: types.GetV1PricestoreChainPriceStoreChainsAddressMetadataParam): Promise<FetchResponse<200, types.GetV1PricestoreChainPriceStoreChainsAddressResponse200>> {
    return this.core.fetch('/v1/pricestore/chain/{chain}/{contract}', 'get', metadata);
  }

  /**
   * This API takes multiple contract addresses to provide price data at once. Multiple
   * contracts must be separated by commas (,).
   *
   * @summary Price for Tokens in bulk
   */
  getV1PricestoreChainPriceStoreChainsTokens(metadata: types.GetV1PricestoreChainPriceStoreChainsTokensMetadataParam): Promise<FetchResponse<200, types.GetV1PricestoreChainPriceStoreChainsTokensResponse200>> {
    return this.core.fetch('/v1/pricestore/chain/{chain}/tokens', 'get', metadata);
  }

  /**
   * This API provides a list of the top gainers in a particular chain. Data for the last 24
   * hours contains the biggest gainers.
   *
   * @summary Top Gainers
   */
  getV1PricestoreChainPriceStoreChainsGainers(metadata: types.GetV1PricestoreChainPriceStoreChainsGainersMetadataParam): Promise<FetchResponse<200, types.GetV1PricestoreChainPriceStoreChainsGainersResponse200>> {
    return this.core.fetch('/v1/pricestore/chain/{chain}/gainers', 'get', metadata);
  }

  /**
   * This API provides a list of the top losers in a particular chain. Data for the last 24
   * hours contains the biggest losers.
   *
   *
   * @summary Top Losers
   */
  getV1PricestoreChainPriceStoreChainsLosers(metadata: types.GetV1PricestoreChainPriceStoreChainsLosersMetadataParam): Promise<FetchResponse<200, types.GetV1PricestoreChainPriceStoreChainsLosersResponse200>> {
    return this.core.fetch('/v1/pricestore/chain/{chain}/losers', 'get', metadata);
  }

  /**
   * This api provides the price for LP tokens by taking in the address of the Lp tokens.
   *
   * @summary LP Tokens Price
   */
  getV1PricestoreChainPriceStoreChainsLptokens(metadata: types.GetV1PricestoreChainPriceStoreChainsLptokensMetadataParam): Promise<FetchResponse<200, types.GetV1PricestoreChainPriceStoreChainsLptokensResponse200>> {
    return this.core.fetch('/v1/pricestore/chain/{chain}/lptokens', 'get', metadata);
  }

  /**
   * The NFT Transactions API allows you to retrieve a list of recent non-fungible token
   * (NFT) transactions associated with a specific wallet address. The response is paginated
   * to ensure efficient handling of large amounts of data, and the transactions are listed
   * in a recent-first order to provide up-to-date information.
   *
   * @summary Nft Transaction History by address
   */
  getV2ChainAddressAddressNftTransactions(metadata: types.GetV2ChainAddressAddressNftTransactionsMetadataParam): Promise<FetchResponse<200, types.GetV2ChainAddressAddressNftTransactionsResponse200>> {
    return this.core.fetch('/v2/{chain}/address/{address}/nft-transactions', 'get', metadata);
  }

  /**
   * Returns metadata of all the nfts within a contract or one specific nft if token id is
   * provided
   *
   * @summary Nft Metadata by contract or specific token id
   */
  getV2ChainAddressAddressDetails(metadata: types.GetV2ChainAddressAddressDetailsMetadataParam): Promise<FetchResponse<200, types.GetV2ChainAddressAddressDetailsResponse200>> {
    return this.core.fetch('/v2/{chain}/address/{address}/details', 'get', metadata);
  }

  /**
   * Get all contract transactions of an NFT, and filter them by token ID (optional)
   *
   * @summary Nft Transaction History by contract or specific token id
   */
  getV1ChainContractAddressNftTransactions(metadata: types.GetV1ChainContractAddressNftTransactionsMetadataParam): Promise<FetchResponse<200, types.GetV1ChainContractAddressNftTransactionsResponse200>> {
    return this.core.fetch('/v1/{chain}/contract/{address}/nft-transactions', 'get', metadata);
  }

  /**
   * This API returns all token Ids available for the specified contract
   *
   *
   * @summary List Nfts under a particular contract
   */
  getV1ChainContractAddressTokenIds(metadata: types.GetV1ChainContractAddressTokenIdsMetadataParam): Promise<FetchResponse<200, types.GetV1ChainContractAddressTokenIdsResponse200>> {
    return this.core.fetch('/v1/{chain}/contract/{address}/tokenIds', 'get', metadata);
  }

  /**
   * This api gives history of owners for a given NFT.
   *
   * @summary Historical Nft holders by Nft
   */
  getV1ChainAddressAddressNftholders(metadata: types.GetV1ChainAddressAddressNftholdersMetadataParam): Promise<FetchResponse<200, types.GetV1ChainAddressAddressNftholdersResponse200>> {
    return this.core.fetch('/v1/{chain}/address/{address}/nftholders', 'get', metadata);
  }

  /**
   * This endpoint allows you to retrieve the total NFT count for a given wallet address
   * across multiple chains.
   *
   * @summary Nft Summary
   */
  getV1AddressAddressNftSummary(metadata: types.GetV1AddressAddressNftSummaryMetadataParam): Promise<FetchResponse<200, types.GetV1AddressAddressNftSummaryResponse200>> {
    return this.core.fetch('/v1/address/{address}/nft-summary', 'get', metadata);
  }

  /**
   * This endpoint allows you to retrieve the total NFT count for a given wallet address
   * across multiple chains.
   *
   * NOTE: If the wallet address has interacted with more than 5000 NFT's the API will return
   * count of NFT holdings for first 5000 contracts
   *
   * @summary Nft Summary V2
   */
  getV2AddressAddressNftSummary(metadata: types.GetV2AddressAddressNftSummaryMetadataParam): Promise<FetchResponse<200, types.GetV2AddressAddressNftSummaryResponse200>> {
    return this.core.fetch('/v2/address/{address}/nft-summary', 'get', metadata);
  }

  /**
   * For a given block number, this endpoint returns block-level details
   *
   * @summary Details by number
   */
  blocksDetailsByBlockNumber(metadata: types.BlocksDetailsByBlockNumberMetadataParam): Promise<FetchResponse<200, types.BlocksDetailsByBlockNumberResponse200>> {
    return this.core.fetch('/v1/{chain}/block/{blockNumber}/details', 'get', metadata);
  }

  /**
   * For a given block hash, this endpoint returns block-level details
   *
   * @summary Details by hash
   */
  blocksDetailsByBlockHash(metadata: types.BlocksDetailsByBlockHashMetadataParam): Promise<FetchResponse<200, types.BlocksDetailsByBlockHashResponse200>> {
    return this.core.fetch('/v1/{chain}/block-hash/{blockHash}/details', 'get', metadata);
  }

  /**
   * **The transactions API fetches the list of all transactions for a given block number,
   * along with their decoded log events.
   *
   * @summary Transactions by blocknumber
   */
  transactionsByBlockNumber(metadata: types.TransactionsByBlockNumberMetadataParam): Promise<FetchResponse<200, types.TransactionsByBlockNumberResponse200>> {
    return this.core.fetch('/v1/{chain}/block/{blockNumber}/transactions', 'get', metadata);
  }

  /**
   * Transaction API returns a list of all transactions for a given block hash, along with
   * their decoded log events.
   *
   * @summary Transactions By block Hash
   * @throws FetchError<401, types.TransactionsByBlockHashResponse401>
   */
  transactionsByBlockHash(metadata: types.TransactionsByBlockHashMetadataParam): Promise<FetchResponse<200, types.TransactionsByBlockHashResponse200>> {
    return this.core.fetch('/v1/{chain}/block-hash/{blockHash}/transactions', 'get', metadata);
  }

  /**
   * All log events related to a given topic between blocks can be fetched via this endpoint.
   * **Filters:** 
   * - **Get All Logs between specified blocks:** Block filtering, return all logs between
   * those blocks, If fromBlock and toBlock are not specified then the recent 5 block logs
   * will be returned. (fromBlock specifies from which block logs should be picked, toBlock
   * specifies till which block)
   *
   * @summary Log events by topics
   */
  getLogEventsByTopics(metadata: types.GetLogEventsByTopicsMetadataParam): Promise<FetchResponse<200, types.GetLogEventsByTopicsResponse200>> {
    return this.core.fetch('/v1/{chain}/topics/logs', 'get', metadata);
  }
}

const createSDK = (() => { return new SDK(); })()
;

export default createSDK;

export type { BlocksDetailsByBlockHashMetadataParam, BlocksDetailsByBlockHashResponse200, BlocksDetailsByBlockNumberMetadataParam, BlocksDetailsByBlockNumberResponse200, FungibleErc20TokenBalancesMetadataParam, FungibleErc20TokenBalancesResponse200, GetLogEventsByTopicsMetadataParam, GetLogEventsByTopicsResponse200, GetV1AddressAddressNftSummaryMetadataParam, GetV1AddressAddressNftSummaryResponse200, GetV1ChainAddressAddressNftholdersMetadataParam, GetV1ChainAddressAddressNftholdersResponse200, GetV1ChainAddressAddressTransactionsCountMetadataParam, GetV1ChainAddressAddressTransactionsCountResponse200, GetV1ChainAddressAddressTransactionsMetadataParam, GetV1ChainAddressAddressTransactionsResponse200, GetV1ChainContractAddressNftTransactionsMetadataParam, GetV1ChainContractAddressNftTransactionsResponse200, GetV1ChainContractAddressTokenIdsMetadataParam, GetV1ChainContractAddressTokenIdsResponse200, GetV1ChainContractContractTopHoldersMetadataParam, GetV1ChainContractContractTopHoldersResponse200, GetV1ChainTokenAddressAddressHoldersCountMetadataParam, GetV1ChainTokenAddressAddressHoldersCountResponse200, GetV1ChainTokenAddressTransactionsMetadataParam, GetV1ChainTokenAddressTransactionsResponse200, GetV1ChainTransactionsTransactionHashMetadataParam, GetV1ChainTransactionsTransactionHashResponse200, GetV1PricestoreChainPriceStoreChainsAddressMetadataParam, GetV1PricestoreChainPriceStoreChainsAddressResponse200, GetV1PricestoreChainPriceStoreChainsGainersMetadataParam, GetV1PricestoreChainPriceStoreChainsGainersResponse200, GetV1PricestoreChainPriceStoreChainsLosersMetadataParam, GetV1PricestoreChainPriceStoreChainsLosersResponse200, GetV1PricestoreChainPriceStoreChainsLptokensMetadataParam, GetV1PricestoreChainPriceStoreChainsLptokensResponse200, GetV1PricestoreChainPriceStoreChainsTokensMetadataParam, GetV1PricestoreChainPriceStoreChainsTokensResponse200, GetV1PricestoreSymbolMetadataParam, GetV1PricestoreSymbolResponse200, GetV1TokenstoreTokenAddressAddressMetadataParam, GetV1TokenstoreTokenAddressAddressResponse200, GetV1TokenstoreTokenAllMetadataParam, GetV1TokenstoreTokenAllResponse200, GetV1TokenstoreTokenSymbolSymbolMetadataParam, GetV1TokenstoreTokenSymbolSymbolResponse200, GetV2AddressAddressNftSummaryMetadataParam, GetV2AddressAddressNftSummaryResponse200, GetV2ChainAddressAddressAssetsMetadataParam, GetV2ChainAddressAddressAssetsResponse200, GetV2ChainAddressAddressDetailsMetadataParam, GetV2ChainAddressAddressDetailsResponse200, GetV2ChainAddressAddressNftTransactionsMetadataParam, GetV2ChainAddressAddressNftTransactionsResponse200, GetV2ChainAddressAddressTransactionsMetadataParam, GetV2ChainAddressAddressTransactionsResponse200, GetV2ChainAddressAddressUserDataMetadataParam, GetV2ChainAddressAddressUserDataResponse200, GetV2ChainTokenAddressTransactionsMetadataParam, GetV2ChainTokenAddressTransactionsResponse200, GetV3BatchAssetsMetadataParam, GetV3BatchAssetsResponse200, GetV3ChainAddressAddressNftAssetsMetadataParam, GetV3ChainAddressAddressNftAssetsResponse200, GetV3ChainAddressAddressTransactionsMetadataParam, GetV3ChainAddressAddressTransactionsResponse200, TransactionsByBlockHashMetadataParam, TransactionsByBlockHashResponse200, TransactionsByBlockHashResponse401, TransactionsByBlockNumberMetadataParam, TransactionsByBlockNumberResponse200 } from './types';

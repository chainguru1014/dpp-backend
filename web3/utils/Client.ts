import {BlockchainAddress} from "@partisiablockchain/abi-client";
import { getRequest, putRequest } from "./Api";
import { SignedTransaction } from "./SignedTransaction";

/** A client for interacting with contracts and accounts on a Partisia blockchain (PBC). */
export class Client {
  private readonly host: string;

  /**
   * Create a new client.
   *
   * @param host the url of the host.
   */
  constructor(host: string) {
    this.host = host;
  }

  private contractStateQueryUrl(address: BlockchainAddress): string {
    return `${this.host}/shards/${this.shardForAddress(
        address
    )}/blockchain/contracts/${address.asString()}?requireContractState=true`;
  }

  private accountStateQueryUrl(address: BlockchainAddress): string {
    return `${this.host}/shards/${this.shardForAddress(
        address
    )}/blockchain/account/${address.asString()}`;
  }

  private shardForAddress(address: BlockchainAddress): string {
    const numOfShards = 3;
    const buffer = address.asBuffer();
    const shardIndex = Math.abs(buffer.readInt32BE(17)) % numOfShards;
    return "Shard" + shardIndex;
  }

  /**
   * Retrieve a contract state from the blockchain.
   *
   * @param address The address of the contract.
   * @return A promise containing the retrieved contract state.
   */
  public getContractState(address: BlockchainAddress): Promise<ZkContract | undefined> {
    return getRequest<ZkContract>(this.contractStateQueryUrl(address));
  }

  /**
   * Retrieve an account state from the blockchain.
   *
   * @param address The address of the account.
   * @return A promise containing the retrieved account state.
   */
  public getAccountState(address: BlockchainAddress): Promise<AccountState | undefined> {
    return getRequest<AccountState>(this.accountStateQueryUrl(address));
  }

  /**
   * Get the chain ID for the running chain.
   *
   * @return a promise containing the chain ID data object.
   */
  public getChainId(): Promise<ChainIdData | undefined> {
    return getRequest<ChainIdData>(`${this.host}/blockchain/chainId`);
  }

  /**
   * Sends a signed transaction to the blockchain.
   *
   * @param fromAddress the address who sent the transaction.
   * @param signedTransaction The signed transaction to send.
   * @return a promise containing the transaction pointer corresponding to the provided signed transaction.
   */
  public putTransaction(
      fromAddress: BlockchainAddress,
      signedTransaction: SignedTransaction
  ): Promise<TransactionPointer> {
    const shardName = this.shardForAddress(fromAddress);
    const url = `${this.host}/shards/${shardName}/blockchain/transaction`;
    return putRequest(url, {
      transactionPayload: signedTransaction.serialize().toString("base64"),
    }).then(() => {
      return { identifier: signedTransaction.identifier(), destinationShard: shardName };
    });
  }
}

/** A pointer to a transaction on the blockchain. */
export interface TransactionPointer {
  /** The hash of the transaction. */
  identifier: Buffer;
  /** The shard. */
  destinationShard: string;
}

/** dto of the chain id. */
type ChainIdData = { chainId: string };

/** dto of the account state. */
type AccountState = { nonce: string };

/** dto of a zk contract on the blockchain. */
export type ZkContract = { serializedContract: { state: { data: string } } };

/** dto of an engine in the zk contract object. */
export interface Engine {
  /** Address of the engine. */
  identity: string;
  /** Public key of the engine encoded in base64. */
  publicKey: string;
  /** Rest interface of the engine. */
  restInterface: string;
}




import { ec as Elliptic } from "elliptic";

import BN from "bn.js";

import { BigEndianByteOutput } from "@secata-public/bitmanipulation-ts";

import {BlockchainAddress} from "@partisiablockchain/abi-client";
import { CryptoUtils } from "./CryptoUtil";


/**

 * A transaction that has been signed by a private key. A signed transaction is ready to be sent to

 * the blockchain. A signed transaction has limited durability, since it includes information about

 * the valid-to-time and the next available nonce of the sending user.

 */

export class SignedTransaction {

  private readonly inner: InnerPart;

  private readonly signature: Elliptic.Signature;

  private readonly hash: Buffer;

  private constructor(inner: InnerPart, signature: Elliptic.Signature, hash: Buffer) {

    this.inner = inner;

    this.signature = signature;

    this.hash = hash;

  }

  /**

   * Create a signed transaction to send to PBC.

   *

   * @param keyPair the key pair to sign the transaction with.

   * @param nonce the nonce of the signing account.

   * @param validToTime the unix time that the transaction is valid to.

   * @param gasCost the amount of gas allocated to executing the transaction.

   * @param chainId the id of the chain.

   * @param transaction the transaction to sign.

   * @return the signed transaction.

   */

  public static create(

      keyPair: Elliptic.KeyPair,

      nonce: BN,

      validToTime: BN,

      gasCost: BN,

      chainId: string,

      transaction: Transaction

  ): SignedTransaction {

    const inner: InnerPart = { nonce, validToTime, gasCost, innerTransaction: transaction };

    const hash = CryptoUtils.hashBuffers([

      serializeInnerPart(inner),

      BigEndianByteOutput.serialize((out) => out.writeString(chainId)),

    ]);

    const signature = keyPair.sign(hash);

    return new SignedTransaction(inner, signature, hash);

  }

  /**

   * Serialize the signed transaction into bytes.

   *

   * @return the serialized bytes.

   */

  public serialize(): Buffer {

    return Buffer.concat([

      CryptoUtils.signatureToBuffer(this.signature),

      serializeInnerPart(this.inner),

    ]);

  }

  /**

   * Get the identifier of this transaction.

   *

   * @return the identify hash

   */

  public identifier(): Buffer {

    return CryptoUtils.hashBuffers([this.hash, CryptoUtils.signatureToBuffer(this.signature)]);

  }

}

/** A transaction. */

export interface Transaction {

  /** The address of the receiver of the transaction. */

  address: BlockchainAddress;

  /** The rpc of the transaction. */

  rpc: Buffer;

}

interface InnerPart {

  nonce: BN;

  validToTime: BN;

  gasCost: BN;

  innerTransaction: Transaction;

}

function serializeInnerPart(innerPart: InnerPart): Buffer {

  return BigEndianByteOutput.serialize((out) => {

    out.writeI64(innerPart.nonce);

    out.writeI64(innerPart.validToTime);

    out.writeI64(innerPart.gasCost);

    out.writeBytes(innerPart.innerTransaction.address.asBuffer());

    out.writeI32(innerPart.innerTransaction.rpc.length);

    out.writeBytes(innerPart.innerTransaction.rpc);

  });

}
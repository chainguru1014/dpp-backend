/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import BN from "bn.js";
import {
  AbiParser,
  AbstractBuilder, BigEndianReader,
  FileAbi, FnKinds, FnRpcBuilder, RpcReader,
  ScValue,ScValueNumber,
  ScValueEnum, ScValueOption,
  ScValueStruct,
  StateReader, TypeIndex,
  BlockchainAddress
} from "@partisiablockchain/abi-client";
import {BigEndianByteOutput} from "@secata-public/bitmanipulation-ts";
var fs = require("fs");

const fileAbi: FileAbi = new AbiParser(fs.readFileSync("./web3/user_contract.abi")).parseAbi();
// console.log(abiBytes);

// const fileAbi: FileAbi = new AbiParser(Buffer.from(
//   "5042434142490904000502000000000301000000085472616e736665720000000200000002746f0d00000006616d6f756e7405010000000a546f6b656e537461746500000007000000046e616d650b00000008646563696d616c73010000000673796d626f6c0b000000056f776e65720d0000000c746f74616c5f737570706c79050000000862616c616e6365730f0d0500000007616c6c6f7765640f0d0f0d05010000000b536563726574566172496400000001000000067261775f69640300000006010000000a696e697469616c697a65ffffffff0f00000004000000046e616d650b0000000673796d626f6c0b00000008646563696d616c73010000000c746f74616c5f737570706c790502000000087472616e73666572010000000200000002746f0d00000006616d6f756e7405020000000d62756c6b5f7472616e736665720200000001000000097472616e73666572730e0000020000000d7472616e736665725f66726f6d03000000030000000466726f6d0d00000002746f0d00000006616d6f756e7405020000001262756c6b5f7472616e736665725f66726f6d04000000020000000466726f6d0d000000097472616e73666572730e00000200000007617070726f76650500000002000000077370656e6465720d00000006616d6f756e74050001",
//   "hex"
// )).parseAbi();
// console.log(fileAbi);

type Option<K> = K | undefined;

export interface Transfer {
  to: BlockchainAddress;
  amount: BN;
}

export function newTransfer(to: BlockchainAddress, amount: BN): Transfer {
  return {to, amount}
}

function fromScValueTransfer(structValue: ScValueStruct): Transfer {
  return {
    to: BlockchainAddress.fromBuffer(structValue.getFieldValue("to")!.addressValue().value),
    amount: structValue.getFieldValue("amount")!.asBN(),
  };
}

function buildRpcTransfer(value: Transfer, builder: AbstractBuilder) {
  const structBuilder = builder.addStruct();
  structBuilder.addAddress(value.to.asBuffer());
  structBuilder.addU128(value.amount);
}

interface MetaData {
  product_id: string | null | undefined;
  contract_address: String | null;
  id: Number;
}

export interface TokenState {
  name: string;
  symbol: string;
  owner: BlockchainAddress;
  totalSupply: BN;
  // userProducts: Map<Number, Array<MetaData>>
  userIdtoTokenId: Map<String, BN>;
}

function fromScValueTokenState(structValue: ScValueStruct): TokenState {
  return {
    name: structValue.getFieldValue("name")!.stringValue(),
    symbol: structValue.getFieldValue("symbol")!.stringValue(),
    owner: BlockchainAddress.fromBuffer(structValue.getFieldValue("contract_owner")!.addressValue().value),
    totalSupply: structValue.getFieldValue("total_count")!.asBN(),
    // userProducts: new Map([...structValue.getFieldValue("user_product_list")!.mapValue().map].map(([k1, v1]) => [k1.asBN().toNumber(), v1.vecValue().values().map((v12) => ({product_id: v12.structValue().getFieldValue("product_id")?.stringValue(), contract_address: BlockchainAddress.fromBuffer(v12.structValue().getFieldValue('contract_address')!.addressValue().value).asString(), id: v12.structValue().getFieldValue('id')?.asBN().toNumber() || 0}))])),
    userIdtoTokenId: new Map([...structValue.getFieldValue("user_id_to_token_id")!.mapValue().map].map(([k2, v2]) => [k2.stringValue(), v2.asBN()])),
  };
}

export function deserializeUserState(bytes: Buffer): TokenState {
  const scValue = new StateReader(bytes, fileAbi.contract).readState();
  return fromScValueTokenState(scValue);
}

export interface SecretVarId {
  rawId: number;
}

export function newSecretVarId(rawId: number): SecretVarId {
  return {rawId}
}

function fromScValueSecretVarId(structValue: ScValueStruct): SecretVarId {
  return {
    rawId: structValue.getFieldValue("raw_id")!.asNumber(),
  };
}

export function initialize(name: string, symbol: string, url_template: string): Buffer {
  const fnBuilder = new FnRpcBuilder("initialize", fileAbi.contract);
  fnBuilder.addString(name);
  fnBuilder.addString(symbol);
  fnBuilder.addString(url_template);
  return fnBuilder.getBytes();
}

export function mint(id:string, wallet:string): Buffer {
  console.log(id, wallet);
  const fnBuilder = new FnRpcBuilder("mint", fileAbi.contract);

  fnBuilder.addString(id);
  fnBuilder.addAddress(wallet);

  return fnBuilder.getBytes();
}

// export function transfer(to: BlockchainAddress, amount: BN): Buffer {
//   const fnBuilder = new FnRpcBuilder("transfer", fileAbi.contract);
//   fnBuilder.addAddress(to.asBuffer());
//   fnBuilder.addU128(amount);
//   return fnBuilder.getBytes();
// }

// export function bulkTransfer(transfers: Transfer[]): Buffer {
//   const fnBuilder = new FnRpcBuilder("bulk_transfer", fileAbi.contract);
//   const vecBuilder7 = fnBuilder.addVec();
//   for (const vecEntry8 of transfers) {
//     buildRpcTransfer(vecEntry8, vecBuilder7);
//   }
//   return fnBuilder.getBytes();
// }

// export function transferFrom(from: BlockchainAddress, to: BlockchainAddress, amount: BN): Buffer {
//   const fnBuilder = new FnRpcBuilder("transfer_from", fileAbi.contract);
//   fnBuilder.addAddress(from.asBuffer());
//   fnBuilder.addAddress(to.asBuffer());
//   fnBuilder.addU128(amount);
//   return fnBuilder.getBytes();
// }

// export function bulkTransferFrom(from: BlockchainAddress, transfers: Transfer[]): Buffer {
//   const fnBuilder = new FnRpcBuilder("bulk_transfer_from", fileAbi.contract);
//   fnBuilder.addAddress(from.asBuffer());
//   const vecBuilder9 = fnBuilder.addVec();
//   for (const vecEntry10 of transfers) {
//     buildRpcTransfer(vecEntry10, vecBuilder9);
//   }
//   return fnBuilder.getBytes();
// }

// export function approve(spender: BlockchainAddress, amount: BN): Buffer {
//   const fnBuilder = new FnRpcBuilder("approve", fileAbi.contract);
//   fnBuilder.addAddress(spender.asBuffer());
//   fnBuilder.addU128(amount);
//   return fnBuilder.getBytes();
// }


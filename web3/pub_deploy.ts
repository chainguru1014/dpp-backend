/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import BN from "bn.js";
import {
  AbiParser,
  AbstractBuilder, BigEndianReader,
  FileAbi, FnKinds, FnRpcBuilder, RpcReader,
  ScValue,
  ScValueEnum, ScValueOption,
  ScValueStruct,
  StateReader, TypeIndex,
  BlockchainAddress
} from "@partisiablockchain/abi-client";
import {BigEndianByteOutput} from "@secata-public/bitmanipulation-ts";

const fileAbi: FileAbi = new AbiParser(Buffer.from(
  "5042434142490900000501000000000501000000195075626c69634465706c6f79436f6e74726163745374617465000000030000000762696e64657273120f12081200010000000c6e65787442696e6465724964080000001373797374656d55706461746541646472657373120d010000000a42696e646572496e666f000000020000000a62696e64696e674a6172120e010000000f76657273696f6e496e74657276616c120002010000001e537570706f7274656442696e64657256657273696f6e496e74657276616c0000000200000019737570706f7274656442696e64657256657273696f6e4d617812000300000019737570706f7274656442696e64657256657273696f6e4d696e120003010000001553656d616e74696356657273696f6e24537461746500000003000000056d616a6f7208000000056d696e6f720800000005706174636808010000001353656d616e74696356657273696f6e2452706300000003000000056d616a6f7208000000056d696e6f720800000005706174636808000000050100000006637265617465ffffffff0f000000040000000a62696e64696e674a61720e0100000019737570706f7274656442696e64657256657273696f6e4d696e000400000019737570706f7274656442696e64657256657273696f6e4d617800040000001373797374656d557064617465416464726573730d020000000e6465706c6f79436f6e7472616374010000000300000008636f6e74726163740e01000000036162690e010000000e696e697469616c697a6174696f6e0e01020000000961646442696e64657202000000030000000a62696e64696e674a61720e0100000019737570706f7274656442696e64657256657273696f6e4d696e000400000019737570706f7274656442696e64657256657273696f6e4d61780004020000000c72656d6f766542696e64657203000000010000000862696e646572496408020000001a6465706c6f79436f6e74726163745769746842696e6465724964040000000400000008636f6e74726163740e01000000036162690e010000000e696e697469616c697a6174696f6e0e010000000862696e6465724964080000",
  "hex"
)).parseAbi();

type Option<K> = K | undefined;

export interface PublicDeployContractState {
  binders: Option<Map<Option<number>, Option<BinderInfo>>>;
  nextBinderId: number;
  systemUpdateAddress: Option<BlockchainAddress>;
}

export function newPublicDeployContractState(binders: Option<Map<Option<number>, Option<BinderInfo>>>, nextBinderId: number, systemUpdateAddress: Option<BlockchainAddress>): PublicDeployContractState {
  return {binders, nextBinderId, systemUpdateAddress}
}

function fromScValuePublicDeployContractState(structValue: ScValueStruct): PublicDeployContractState {
  return {
    binders: structValue.getFieldValue("binders")!.optionValue().valueOrUndefined((sc1) => new Map([...sc1.mapValue().map].map(([k2, v3]) => [k2.optionValue().valueOrUndefined((sc4) => sc4.asNumber()), v3.optionValue().valueOrUndefined((sc5) => fromScValueBinderInfo(sc5.structValue()))]))),
    nextBinderId: structValue.getFieldValue("nextBinderId")!.asNumber(),
    systemUpdateAddress: structValue.getFieldValue("systemUpdateAddress")!.optionValue().valueOrUndefined((sc6) => BlockchainAddress.fromBuffer(sc6.addressValue().value)),
  };
}

export function deserializePublicDeployContractState(bytes: Buffer): PublicDeployContractState {
  const scValue = new StateReader(bytes, fileAbi.contract).readState();
  return fromScValuePublicDeployContractState(scValue);
}

export interface BinderInfo {
  bindingJar: Option<number[]>;
  versionInterval: Option<SupportedBinderVersionInterval>;
}

export function newBinderInfo(bindingJar: Option<number[]>, versionInterval: Option<SupportedBinderVersionInterval>): BinderInfo {
  return {bindingJar, versionInterval}
}

function fromScValueBinderInfo(structValue: ScValueStruct): BinderInfo {
  return {
    bindingJar: structValue.getFieldValue("bindingJar")!.optionValue().valueOrUndefined((sc7) => sc7.vecValue().values().map((sc8) => sc8.asNumber())),
    versionInterval: structValue.getFieldValue("versionInterval")!.optionValue().valueOrUndefined((sc9) => fromScValueSupportedBinderVersionInterval(sc9.structValue())),
  };
}

export interface SupportedBinderVersionInterval {
  supportedBinderVersionMax: Option<SemanticVersion$State>;
  supportedBinderVersionMin: Option<SemanticVersion$State>;
}

export function newSupportedBinderVersionInterval(supportedBinderVersionMax: Option<SemanticVersion$State>, supportedBinderVersionMin: Option<SemanticVersion$State>): SupportedBinderVersionInterval {
  return {supportedBinderVersionMax, supportedBinderVersionMin}
}

function fromScValueSupportedBinderVersionInterval(structValue: ScValueStruct): SupportedBinderVersionInterval {
  return {
    supportedBinderVersionMax: structValue.getFieldValue("supportedBinderVersionMax")!.optionValue().valueOrUndefined((sc10) => fromScValueSemanticVersion$State(sc10.structValue())),
    supportedBinderVersionMin: structValue.getFieldValue("supportedBinderVersionMin")!.optionValue().valueOrUndefined((sc11) => fromScValueSemanticVersion$State(sc11.structValue())),
  };
}

export interface SemanticVersion$State {
  major: number;
  minor: number;
  patch: number;
}

export function newSemanticVersion$State(major: number, minor: number, patch: number): SemanticVersion$State {
  return {major, minor, patch}
}

function fromScValueSemanticVersion$State(structValue: ScValueStruct): SemanticVersion$State {
  return {
    major: structValue.getFieldValue("major")!.asNumber(),
    minor: structValue.getFieldValue("minor")!.asNumber(),
    patch: structValue.getFieldValue("patch")!.asNumber(),
  };
}

export interface SemanticVersion$Rpc {
  major: number;
  minor: number;
  patch: number;
}

export function newSemanticVersion$Rpc(major: number, minor: number, patch: number): SemanticVersion$Rpc {
  return {major, minor, patch}
}

function fromScValueSemanticVersion$Rpc(structValue: ScValueStruct): SemanticVersion$Rpc {
  return {
    major: structValue.getFieldValue("major")!.asNumber(),
    minor: structValue.getFieldValue("minor")!.asNumber(),
    patch: structValue.getFieldValue("patch")!.asNumber(),
  };
}

function buildRpcSemanticVersion$Rpc(value: SemanticVersion$Rpc, builder: AbstractBuilder) {
  const structBuilder = builder.addStruct();
  structBuilder.addI32(value.major);
  structBuilder.addI32(value.minor);
  structBuilder.addI32(value.patch);
}

export function create(bindingJar: number[], supportedBinderVersionMin: SemanticVersion$Rpc, supportedBinderVersionMax: SemanticVersion$Rpc, systemUpdateAddress: BlockchainAddress): Buffer {
  const fnBuilder = new FnRpcBuilder("create", fileAbi.contract);
  const vecBuilder12 = fnBuilder.addVec();
  for (const vecEntry13 of bindingJar) {
    vecBuilder12.addU8(vecEntry13);
  }
  buildRpcSemanticVersion$Rpc(supportedBinderVersionMin, fnBuilder);
  buildRpcSemanticVersion$Rpc(supportedBinderVersionMax, fnBuilder);
  fnBuilder.addAddress(systemUpdateAddress.asBuffer());
  return fnBuilder.getBytes();
}

export function deployContract(contract: number[], abi: number[], initialization: number[]): Buffer {
  const fnBuilder = new FnRpcBuilder("deployContract", fileAbi.contract);
  const vecBuilder14 = fnBuilder.addVec();
  for (const vecEntry15 of contract) {
    vecBuilder14.addU8(vecEntry15);
  }
  const vecBuilder16 = fnBuilder.addVec();
  for (const vecEntry17 of abi) {
    vecBuilder16.addU8(vecEntry17);
  }
  const vecBuilder18 = fnBuilder.addVec();
  for (const vecEntry19 of initialization) {
    vecBuilder18.addU8(vecEntry19);
  }
  return fnBuilder.getBytes();
}

export function addBinder(bindingJar: number[], supportedBinderVersionMin: SemanticVersion$Rpc, supportedBinderVersionMax: SemanticVersion$Rpc): Buffer {
  const fnBuilder = new FnRpcBuilder("addBinder", fileAbi.contract);
  const vecBuilder20 = fnBuilder.addVec();
  for (const vecEntry21 of bindingJar) {
    vecBuilder20.addU8(vecEntry21);
  }
  buildRpcSemanticVersion$Rpc(supportedBinderVersionMin, fnBuilder);
  buildRpcSemanticVersion$Rpc(supportedBinderVersionMax, fnBuilder);
  return fnBuilder.getBytes();
}

export function removeBinder(binderId: number): Buffer {
  const fnBuilder = new FnRpcBuilder("removeBinder", fileAbi.contract);
  fnBuilder.addI32(binderId);
  return fnBuilder.getBytes();
}

export function deployContractWithBinderId(contract: Buffer, abi: Buffer,
                                           initialization: Buffer, binderId: number): Buffer {
  const fnBuilder = new FnRpcBuilder("deployContractWithBinderId", fileAbi.contract);
  const vecBuilder22 = fnBuilder.addVec();
  for (const vecEntry23 of contract) {
    vecBuilder22.addU8(vecEntry23);
  }
  const vecBuilder24 = fnBuilder.addVec();
  for (const vecEntry25 of abi) {
    vecBuilder24.addU8(vecEntry25);
  }
  const vecBuilder26 = fnBuilder.addVec();
  for (const vecEntry27 of initialization) {
    vecBuilder26.addU8(vecEntry27);
  }
  fnBuilder.addI32(binderId);
  return fnBuilder.getBytes();
}


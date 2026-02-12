import {BlockchainAddress} from "@partisiablockchain/abi-client";
import BN from "bn.js";
import {initialize, batch_mint, deserializeTokenState, transfer_from} from "./nft_contract";
import {deployContractWithBinderId} from "./pub_deploy"
import {Client} from "./utils/Client";
import {TransactionSender} from "./utils/TransactionSender";
import {CryptoUtils} from "./utils/CryptoUtil";
import { deserializeUserState, mint } from "./user_contract";

function formatDate(date: any) {
  var d = new Date(date),
      month = '' + (d.getMonth() + 1),
      day = '' + d.getDate(),
      year = d.getFullYear();

  if (month.length < 2) 
      month = '0' + month;
  if (day.length < 2) 
      day = '0' + day;

  return [year, month, day].join('.');
}

var fs = require("fs");
const delay = (ms : any) => new Promise(resolve => setTimeout(resolve, ms))

const TESTNET_URL = "https://node1.testnet.partisiablockchain.com";
const client = new Client(TESTNET_URL);

let SENDER_PRIVATE_KEY: string = "4931e8190e5ef42c225c86845abe7934dd704ca9d133d5dc7128c8e04db00ca6";
let SENDER_PUBLICK_KEY: string = "00eacdb88750935eb88610a9a69cb22334965b8225";
let USER_SC_ADDRESS: string = "02ef71ae5657f5cd41f5ecbd9675e1277558f439fd";
//4931e8190e5ef42c225c86845abe7934dd704ca9d133d5dc7128c8e04db00ca6
//2e4fd54916e7e953cffd11bf13cc952e07863f957f8264be4f9ea1a1d9d5904c

export const initClient = async (product_id: any) => {
  try {
    console.log("initClient");
    
    // This contract address is pub-deploy
    let contractAddress: BlockchainAddress = BlockchainAddress.fromString(
        "0197a0e238e924025bad144aa0c4913e46308f9a4d");

    const transactionSender = TransactionSender.create(client, SENDER_PRIVATE_KEY);

    const initPayload = initialize("name", "symbol", product_id.toString(), USER_SC_ADDRESS, "https://example.com");

    const wasmBytes: Buffer = fs.readFileSync("./web3/nft_contract.wasm");
    const abiBytes: Buffer = fs.readFileSync("./web3/nft_contract.abi");
    const rpc = deployContractWithBinderId(wasmBytes, abiBytes, initPayload, 4);

    // Send the transaction
    const transactionPointer = await transactionSender.sendAndSign(
        {
          address: contractAddress,
          rpc: rpc,
        },
        new BN(2500000),
    );

    const txIdentifier = transactionPointer.transactionPointer.identifier.toString("hex");
    // eslint-disable-next-line no-console
    console.log("Sent input in transaction: " + txIdentifier);
    const deployedAddress = '02' + txIdentifier.slice(txIdentifier.length - 40);
    return deployedAddress;

  } catch (error) {
    console.log(error);
    return null;
  }
};

export const mintUser = async (id: string, wallet: string) => {
  try {
    console.log("mint user to", USER_SC_ADDRESS);
    // This contract address is pub-deploy
    let contractAddress: BlockchainAddress = BlockchainAddress.fromString(USER_SC_ADDRESS);

    const transactionSender = TransactionSender.create(client, SENDER_PRIVATE_KEY);
    const rpc = mint(id, wallet);

    // Send the transaction
    const transactionPointer = await transactionSender.sendAndSign(
        {
          address: contractAddress,
          rpc: rpc,
        },
        new BN(100000)
    );

    const txIdentifier = transactionPointer.transactionPointer.identifier.toString("hex");
    // eslint-disable-next-line no-console
    console.log("Sent input in transaction: " + txIdentifier);

  } catch (error) {
    console.log(error);
  }
};

export const batchMint = async (to: string, contract_address: string, count: number) => {
  try {
    console.log("batch mint", contract_address);
    await delay(2000);
    // This contract address is pub-deploy
    let contractAddress: BlockchainAddress = BlockchainAddress.fromString(
        contract_address);

    let cDate = new Date();
    let startDate = formatDate(cDate);
    let endDate = formatDate(cDate.setFullYear(cDate.getFullYear() + 1));
    console.log(startDate, endDate);

    const transactionSender = TransactionSender.create(client, SENDER_PRIVATE_KEY);
    const rpc = batch_mint(to, new BN(count), 'minted', startDate, endDate);

    // Send the transaction
    const transactionPointer = await transactionSender.sendAndSign(
        {
          address: contractAddress,
          rpc: rpc,
        },
        new BN(1000000)
    );

    const txIdentifier = transactionPointer.transactionPointer.identifier.toString("hex");
    // eslint-disable-next-line no-console
    console.log("Sent input in transaction: " + txIdentifier);

  } catch (error) {
    console.log(error);
  }
};

export const transferProduct = async (contract_address: string, from: string, to: string, token_id: number) => {
  try {
    console.log("transfer product", contract_address, from, to, token_id);
    // This contract address is pub-deploy
    let contractAddress: BlockchainAddress = BlockchainAddress.fromString(
        contract_address);

    const transactionSender = TransactionSender.create(client, SENDER_PRIVATE_KEY);
    const rpc = transfer_from(from, to, new BN(token_id));

    // Send the transaction
    const transactionPointer = await transactionSender.sendAndSign(
        {
          address: contractAddress,
          rpc: rpc,
        },
        new BN(100000)
    );

    const txIdentifier = transactionPointer.transactionPointer.identifier.toString("hex");
    // eslint-disable-next-line no-console
    console.log("Sent input in transaction: " + txIdentifier);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
};

export const getNonce = async () : Promise<any> => {
  let account: BlockchainAddress = BlockchainAddress.fromString(SENDER_PUBLICK_KEY);
  const res = await client.getAccountState(account);
  return res?.nonce;
}

export const getProductMetadataFromSC = async (contract_address: string, token_id: number) : Promise<any> => {
  console.log('Fetch Status from SC', contract_address);
  let contractAddress: BlockchainAddress = BlockchainAddress.fromString(contract_address);
  const contract = await client.getContractState(contractAddress);
  if (contract != null) {
    const stateBuffer = Buffer.from(contract.serializedContract.state.data, "base64");
    const state = deserializeTokenState(stateBuffer);
    console.log(state);
    console.log(state.metadata[token_id - 1]);
    return state.metadata[token_id - 1];
  }
  return true;
}

export const getUserTokenIdFromId = async (user_id: any) => {
  console.log('Get User Token Id with id');
  let contractAddress: BlockchainAddress = BlockchainAddress.fromString(USER_SC_ADDRESS);
  const contract = await client.getContractState(contractAddress);
  if (contract != null) {
    const stateBuffer = Buffer.from(contract.serializedContract.state.data, "base64");
    const state = deserializeUserState(stateBuffer);
    const userid = state.userIdtoTokenId.get(user_id.toString())?.toNumber() || 0;
    // console.log(state.userIdtoTokenId.get(user_id.toString())?.toNumber());
    // console.log(state.userProducts.get(userid));
    // console.log(state.userProducts.get(state.userIdtoTokenId.get(user_id.toString())!));
    // return {token_id: state.userIdtoTokenId.get(user_id.toString())?.toNumber(), products: state.userProducts.get(userid)};
    return {token_id: state.userIdtoTokenId.get(user_id.toString())?.toNumber()};
  }
}

// (async () => {
//   await initClient();
// })()
//     .catch(e => {
//       // Deal with the fact the chain failed
//     });
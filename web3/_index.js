"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initClient = void 0;
var bn_js_1 = require("bn.js");
var partisia_blockchain_applications_crypto_1 = require("partisia-blockchain-applications-crypto");
var partisia_sdk_1 = require("partisia-sdk");
var partisia_blockchain_applications_rpc_1 = require("partisia-blockchain-applications-rpc");
var BufferWritter_1 = require("./BufferWritter");
var root_mvp_contract_1 = require("./root-mvp-contract");
var initClient = function () { return __awaiter(void 0, void 0, void 0, function () {
    var partisiaSdk, connectionConfig, rpc, adminPrivateKey, rootContractAddress, adminAddress, account, nonce, ownerId, tenderId, createTenderPayload, bufferWriter, payload, signature, transactionPayload, transactionPayloadData, result, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 4, , 5]);
                console.log("initClient");
                partisiaSdk = new partisia_sdk_1.default();
                partisiaSdk.connect({
                    // eslint-disable-next-line
                    permissions: ["sign"],
                    dappName: "Example",
                    chainId: "Partisia Blockchain Testnet",
                }).then(function () { return console.log("Fuck dig jens"); });
                connectionConfig = {
                    urlBaseGlobal: { url: 'https://node1.testnet.partisiablockchain.com', shard_id: 0 },
                    urlBaseShards: [
                        { url: 'https://node1.testnet.partisiablockchain.com/shards/Shard0', shard_id: 0 },
                        { url: 'https://node1.testnet.partisiablockchain.com/shards/Shard1', shard_id: 1 },
                        { url: 'https://node1.testnet.partisiablockchain.com/shards/Shard1', shard_id: 2 },
                    ]
                };
                rpc = (0, partisia_blockchain_applications_rpc_1.PartisiaAccount)(connectionConfig);
                adminPrivateKey = "00000000000000000000000000000000000000000000000000000000000000AA";
                rootContractAddress = "023460205f066896f58bf9cac3e22efcebfb2c484a";
                adminAddress = partisia_blockchain_applications_crypto_1.partisiaCrypto.wallet.privateKeyToAccountAddress(adminPrivateKey);
                // get account info
                console.log(adminAddress);
                return [4 /*yield*/, rpc.getAccount(adminAddress)];
            case 1:
                account = _a.sent();
                if (account === null) {
                    throw new Error("Partisia account not found");
                }
                return [4 /*yield*/, rpc.getNonce(adminAddress, account.shard_id)];
            case 2:
                nonce = _a.sent();
                ownerId = new bn_js_1.default(1);
                tenderId = new bn_js_1.default(7);
                createTenderPayload = (0, root_mvp_contract_1.createTender)(ownerId, tenderId);
                bufferWriter = new BufferWritter_1.BufferWriter();
                bufferWriter.writeLongBE(new bn_js_1.default(nonce));
                bufferWriter.writeLongBE(new bn_js_1.default(new Date().getTime() + 100000));
                bufferWriter.writeLongBE(new bn_js_1.default(100000));
                bufferWriter.writeHexString(rootContractAddress);
                bufferWriter.writeDynamicBuffer(createTenderPayload);
                payload = bufferWriter.toBuffer();
                console.log("txSerialized:", payload);
                signature = partisia_blockchain_applications_crypto_1.partisiaCrypto.wallet.signTransaction(payload, adminPrivateKey);
                transactionPayload = Buffer.concat([signature, payload]);
                transactionPayloadData = transactionPayload.toString('base64');
                return [4 /*yield*/, rpc.broadcastTransaction(adminAddress, transactionPayloadData)];
            case 3:
                result = _a.sent();
                console.log(result);
                return [3 /*break*/, 5];
            case 4:
                error_1 = _a.sent();
                console.log(error_1);
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.initClient = initClient;
(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, exports.initClient)()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); })().catch(function (e) {
    // Deal with the fact the chain failed
});

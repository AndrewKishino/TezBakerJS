import Sotez from 'sotez';
import { BakerInterface, BakerOptions, Head, StoreInterface } from './types';
/**
 * Baker Module
 * @class Baker
 * @param {String} [provider='http://127.0.0.1:8732'] Address of the node
 * @param {String} [chain='main'] Chain Id
 * @param {String} [network='main'] Network ['main', 'zero', 'alpha']
 * @param {Boolean} [debugMode=false]
 * @example
 * import { Baker } from 'sotez';
 * const baker = new Baker('https://127.0.0.1:8732');
 * await baker.importKey('edsk....');
 * // await baker.importLedger();
 * let bakerIntervalID = baker.start();
 */
export default class Baker extends Sotez implements BakerInterface {
    store: StoreInterface;
    startLevel: number;
    bakeIntervalId: number | boolean;
    injectedBlocks: Array<any>;
    lockBaker: boolean;
    head: any;
    pendingBlocks: Array<any>;
    badOps: Array<any>;
    endorsedBlocks: Array<any>;
    noncesToReveal: Array<any>;
    lastLevel: number;
    bakedBlocks: Array<any>;
    mempoolChecks: Array<boolean>;
    requiredEndorsements: number;
    mempoolCheckCount: number;
    bakerDebugMode: boolean;
    CONSTANTS: any;
    constructor(provider: string, chain?: string, net?: string, options?: BakerOptions);
    /**
     * @description Sets network level constants
     * @param  {String} network The network
     */
    getConstants: (network: string) => {
        cycleLength: number;
        threshold: number;
        mempool: string;
        commitment: number;
        powHeader: string;
    };
    logOutput: (...args: any) => void;
    loadNonces: () => void;
    addNonce: (n: any) => void;
    revealNonces: (head: Head) => void;
    levelToCycle: (l: number) => number;
    cycleToLevelStart: (c: number) => number;
    cycleToLevelEnd: (c: number) => number;
    run: () => Promise<void>;
    reveal: (head: Head, nonce: any) => any;
    endorse: (head: Head) => any;
    mempoolCheck: (mempool: any) => boolean;
    bake: (head: Head, priority: number, timestamp: any) => Promise<any>;
    powLoop: (forged: string, priority: number, seedHex: string, cb: (arg0: string, arg1: number) => Promise<any>) => void;
    createProtocolData: (priority: number, powHeader?: string, pow?: string, seed?: string) => string;
    checkHash: (buf: any) => Promise<boolean>;
    stampcheck: (s: any) => number;
    dateToTime: (dd: any) => number;
    getDateNow: () => string;
    operationPass: (applied: any) => 1 | 0 | 2 | 3;
    load: (s: any) => void;
    start: () => number | boolean;
    stop: () => void;
}

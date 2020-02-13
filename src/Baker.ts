import Sotez, { utility, constants } from 'sotez';
import _sodium from 'libsodium-wrappers';

import {
  BakerInterface,
  BakerOptions,
  Head,
  Keys,
  Signed,
  StoreInterface,
} from './types';

// CONSTANTS
const CONSTANTS = {
  MAINNET: {
    cycleLength: 4096,
    threshold: 70368744177663,
    mempool: 'mempool/pending_operations',
    commitment: 32,
    powHeader: '00000003',
  },
  TESTNET: {
    cycleLength: 2048,
    threshold: 70368744177663,
    mempool: 'mempool/pending_operations',
    commitment: 32,
    powHeader: '00000003',
  },
  ZERONET: {
    cycleLength: 128,
    threshold: 70368744177663,
    mempool: 'mempool/pending_operations',
    commitment: 32,
    powHeader: '00000003',
  },
};

const PRIORITY_MAP: { [key: number]: number } = {
  0: 24,
  1: 17,
  2: 7,
};

class Store implements StoreInterface {
  _bknonces: Array<string>;

  constructor() {
    this._bknonces = [];
  }

  get bknonces(): Array<string> {
    if (!this._bknonces) {
      return [];
    }
    return this._bknonces;
  }

  set bknonces(nonces: Array<string>) {
    if (!Array.isArray(nonces)) {
      throw new Error('Nonces must be an array.');
    }
    this._bknonces = nonces;
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

  constructor(
    provider: string,
    chain: string = 'main',
    net: string = 'zeronet',
    options: BakerOptions = {},
  ) {
    super(provider, chain);
    this.store = new Store();
    this.startLevel = 0;
    this.bakeIntervalId = false;
    this.injectedBlocks = [];
    this.lockBaker = false;
    this.head = null;
    this.pendingBlocks = [];
    this.badOps = [];
    this.endorsedBlocks = [];
    this.noncesToReveal = [];
    this.lastLevel = 0;
    this.bakedBlocks = [];
    this.requiredEndorsements = 0;
    this.mempoolCheckCount = 0;
    this.bakerDebugMode = options.debugMode || true;
    this.CONSTANTS = this.getConstants(net);
  }

  /**
   * @description Sets network level constants
   * @param  {String} network The network
   */
  getConstants = (network: string) => {
    const constants = CONSTANTS.TESTNET;
    if (network === 'mainnet') {
      return CONSTANTS.MAINNET;
    }
    if (network === 'zeronet') {
      return CONSTANTS.ZERONET;
    }
    return constants;
  };

  logOutput = (...args: any) => {
    if (this.bakerDebugMode) {
      console.log(...args);
    }
  };

  loadNonces = () => {
    this.noncesToReveal = this.store.bknonces;
  };

  addNonce = (n: any) => {
    this.noncesToReveal.push(n);
    this.store.bknonces = this.noncesToReveal;
  };

  revealNonces = (head: Head) => {
    const newNonces = [];
    for (let i = 0; i < this.noncesToReveal.length; i++) {
      const startReveal = this.cycleToLevelStart(
        this.levelToCycle(this.noncesToReveal[i].level) + 1,
      );
      const endReveal = this.cycleToLevelEnd(
        this.levelToCycle(this.noncesToReveal[i].level) + 1,
      );
      if (head.header.level > endReveal) {
        this.logOutput(
          `!Abandon nonce ${this.noncesToReveal[i].seed} for level ${this.noncesToReveal[i].level}`,
        );
      }
      if (
        head.header.level >= startReveal &&
        this.noncesToReveal[i].revealed === false
      ) {
        this.logOutput(
          `!Revealing nonce ${this.noncesToReveal[i].seed} for level ${this.noncesToReveal[i].level}`,
        );
        this.reveal(this.head, this.noncesToReveal[i]);
        continue;
      } else {
        newNonces.push(this.noncesToReveal[i]);
      }
    }
    if (newNonces.length !== this.noncesToReveal.length) {
      this.noncesToReveal = newNonces;
      this.store.bknonces = this.noncesToReveal;
    }
  };

  levelToCycle = (l: number) =>
    Math.floor((l - 1) / this.CONSTANTS.cycleLength);

  cycleToLevelStart = (c: number) => c * this.CONSTANTS.cycleLength + 1;

  cycleToLevelEnd = (c: number) =>
    this.cycleToLevelStart(c) + this.CONSTANTS.cycleLength - 1;

  // Run baker
  run = async () => {
    // Inject pending blocks
    const nb = [];
    for (let i = 0; i < this.pendingBlocks.length; i++) {
      const pendingBlock = this.pendingBlocks[i];
      if (pendingBlock.level <= this.head.header.level) continue;
      if (this.injectedBlocks.indexOf(pendingBlock.level) >= 0) continue;

      if (
        this.dateToTime(this.getDateNow()) >=
        this.dateToTime(pendingBlock.timestamp)
      ) {
        this.injectedBlocks.push(pendingBlock.level);
        this.query(
          `/injection/block?chain=${pendingBlock.chain_id}`,
          pendingBlock.data,
        )
          .then((hash: any) => {
            if (pendingBlock.seed) {
              this.addNonce({
                hash,
                seed_nonce_hash: pendingBlock.seed_nonce_hash,
                seed: pendingBlock.seed,
                level: pendingBlock.level,
                revealed: false,
              });
              this.logOutput(
                `\x1b[92m+Injected block ${hash} at level ${pendingBlock.level} with seed ${pendingBlock.seed}\x1b[0m`,
              );
            } else {
              this.logOutput(
                `\x1b[92m+Injected block ${hash} at level ${pendingBlock.level} with no seed\x1b[0m`,
              );
            }
          })
          .catch((e: string) => {
            const error = JSON.parse(e);
            if (
              Array.isArray(error) &&
              error.length &&
              typeof error[0].operation !== 'undefined'
            ) {
              this.badOps.push(error[0].operation);
            }
            if (
              Array.isArray(error) &&
              error.length &&
              typeof error[0].id !== 'undefined'
            ) {
              // @ts-ignore
              this.logOutput(error[0].id, pendingBlock);
            }
            this.logOutput('\x1b[91m-Failed to bake with error\x1b[0m');
            console.error('Inject failed', error);
          });
      } else {
        nb.push(pendingBlock);
      }
    }

    this.pendingBlocks = nb;

    if (this.lockBaker) {
      return;
    }

    this.lockBaker = true;
    this.head = await this.getHead();
    this.lockBaker = false;

    // Run revealer
    this.revealNonces(this.head);

    // TODO: Run accuser

    // Standown for 1 block
    if (this.startLevel === 0) {
      this.startLevel = this.head.header.level + 1;
      this.logOutput(
        `\x1b[96mInitiate stand-down - starting at level ${this.startLevel}\x1b[0m`,
      );
    }

    if (this.startLevel > this.head.header.level) {
      return;
    }

    // Run endorser
    if (this.endorsedBlocks.indexOf(this.head.header.level) < 0) {
      (async head => {
        try {
          const rights = await this.query(
            `/chains/${head.chain_id}/blocks/${
              head.hash
            }/helpers/endorsing_rights?level=${
              head.header.level
            }&delegate=${this.key.publicKeyHash()}`,
          );

          if (head.header.level !== this.head.header.level) {
            this.logOutput('\x1b[93mHead changed!\x1b[0m');
            return;
          }

          if (rights.length > 0) {
            if (this.endorsedBlocks.indexOf(head.header.level) < 0) {
              this.endorsedBlocks.push(head.header.level);
              this.endorse(head)
                .then((r: any) => {
                  this.logOutput(
                    `\x1b[92m+Endorsed block ${head.hash} (${r})\x1b[0m`,
                  );
                })
                .catch(() => {
                  this.logOutput(
                    `\x1b[91m!Failed to endorse block ${head.hash}\x1b[0m`,
                  );
                });
            }
          }
        } catch (e) {
          this.logOutput(
            `\x1b[91m!Failed to endorse block ${head.hash}\x1b[0m`,
          );
        }
      })(this.head);
    }

    // Run baker
    if (this.bakedBlocks.indexOf(this.head.header.level + 1) < 0) {
      (async head => {
        try {
          const rights = await this.query(
            `/chains/${head.chain_id}/blocks/${
              head.hash
            }/helpers/baking_rights?level=${head.header.level +
              1}&delegate=${this.key.publicKeyHash()}`,
          );

          if (head.header.level !== this.head.header.level) {
            this.logOutput('\x1b[93mHead changed!\x1b[0m');
            return;
          }

          if (this.bakedBlocks.indexOf(head.header.level + 1) < 0) {
            if (rights.length <= 0) {
              this.bakedBlocks.push(head.header.level + 1);
              this.logOutput('\x1b[93mNothing to bake this level\x1b[0m');
              return;
            }
            if (
              this.dateToTime(this.getDateNow()) >=
                this.dateToTime(rights[0].estimated_time) &&
              rights[0].level === head.header.level + 1
            ) {
              this.bakedBlocks.push(head.header.level + 1);
              this.logOutput(
                `\x1b[96m-Trying to bake ${rights[0].level}/${rights[0].priority}... (${rights[0].estimated_time})\x1b[0m`,
              );
              this.bake(head, rights[0].priority, rights[0].estimated_time)
                .then((r: { data: { operations: { length: any }[] } }) => {
                  this.pendingBlocks.push(r);
                  this.logOutput(
                    `\x1b[96m-Added potential block for level ${head.header
                      .level + 1}: [[+${r.data.operations[0].length}], [+${
                      r.data.operations[1].length
                    }], [+${r.data.operations[2].length}], [+${
                      r.data.operations[3].length
                    }]]\x1b[0m`,
                  );
                })
                .catch(() =>
                  this.logOutput(
                    `\x1b[91m-Couldn't bake ${head.header.level + 1}\x1b[0m`,
                  ),
                );
            }
            // return false;
          }
        } catch (e) {
          // @ts-ignore
          this.logOutput('\x1b[91m!Error\x1b[0m', e);
        }
      })(this.head);
    }
  };

  // Baker functions
  reveal = (head: Head, nonce: any) => {
    let sopbytes: any;
    const opOb: any = {
      branch: head.hash,
      contents: [
        {
          kind: 'seed_nonce_revelation',
          level: nonce.level,
          nonce: nonce.seed,
        },
      ],
    };
    return this.query(
      `/chains/${head.chain_id}/blocks/${head.hash}/helpers/forge/operations`,
      opOb,
    )
      .then(async (forgedBytes: string) => {
        opOb.protocol = head.protocol;
        const signed = await this.key.sign(
          forgedBytes,
          utility.mergebuf(
            constants.watermark.endorsement,
            utility.b58cdecode(head.chain_id, constants.prefix.Net),
          ),
        );
        sopbytes = signed.sbytes;
        opOb.signature = signed.prefixSig;
        return this.query(
          `/chains/${head.chain_id}/blocks/${head.hash}/helpers/preapply/operations`,
          [opOb],
        );
      })
      .then(() => this.query('/injection/operation', sopbytes))
      .then((f: any) => {
        this.logOutput(
          `\x1b[96m!Nonce has been revealed for level ${nonce.level}\x1b[0m`,
        );
        nonce.revealed = true;
        return f;
      })
      .catch((e: any) => {
        this.logOutput(
          `\x1b[91m!Couldn't reveal nonce for ${nonce.level}\x1b[0m`,
        );
        this.logOutput(e);
        nonce.revealed = true;
      });
  };

  endorse = (head: Head) => {
    // eslint-disable-line
    let sopbytes: any;
    const opOb: any = {
      branch: head.hash,
      contents: [
        {
          kind: 'endorsement',
          level: head.header.level,
        },
      ],
    };
    return this.query(
      `/chains/${head.chain_id}/blocks/${head.hash}/helpers/forge/operations`,
      opOb,
    )
      .then(async (forgedBytes: string) => {
        opOb.protocol = head.protocol;
        const signed = await this.key.sign(
          forgedBytes,
          utility.mergebuf(
            constants.watermark.endorsement,
            utility.b58cdecode(head.chain_id, constants.prefix.Net),
          ),
        );
        sopbytes = signed.sbytes;
        opOb.signature = signed.prefixSig;
        return this.query(
          `/chains/${head.chain_id}/blocks/${head.hash}/helpers/preapply/operations`,
          [opOb],
        );
      })
      .then(() => this.query('/injection/operation', sopbytes))
      .then((f: any) => f)
      .catch((e: any) => this.logOutput(e));
  };

  mempoolCheck = (mempool: any) => {
    // Don't get into a waiting loop
    if (this.mempoolCheckCount >= 10) {
      this.mempoolCheckCount = 0;
      return true;
    }

    let mempoolEndorsements = 0;

    // Keep track of how many endorsements have been seen within the mempool
    mempool.applied.forEach((operation: any) => {
      if (operation.contents.some((op: any) => op.kind === 'endorsement')) {
        mempoolEndorsements++;
      }
    });

    if (mempoolEndorsements < this.requiredEndorsements) {
      this.mempoolCheckCount++;
      return false;
    } else {
      this.requiredEndorsements = 0;
      console.log('Mempool Endorsements:', mempoolEndorsements);
      return true;
    }
  };

  bake = async (head: Head, priority: number, timestamp: any): Promise<any> => {
    let operations = [[], [], [], []];
    let seed = '';
    let seedHex = '';
    let nonceHash = '';
    const newLevel = head.header.level + 1;

    const commitmentOffset = this.network === 'zero' ? 1 : 0;
    if (newLevel % this.CONSTANTS.commitment === commitmentOffset) {
      seed = utility.hexNonce(64);

      try {
        await _sodium.ready;
      } catch (e) {
        throw new Error(e);
      }

      const sodium = _sodium;
      const seedHash = sodium.crypto_generichash(32, utility.hex2buf(seed));
      nonceHash = utility.b58cencode(seedHash, constants.prefix.nce);
      seedHex = utility.buf2hex(seedHash);
      this.logOutput(`\x1b[96mNonce required for level ${newLevel}\x1b[0m`);
    }

    const mempool = await this.query(
      `/chains/${head.chain_id}/${this.CONSTANTS.mempool}`,
    );
    if (!this.mempoolCheck(mempool)) {
      await sleep(500);
      return this.bake(head, priority, timestamp);
    }

    const addedOps = [];
    // const endorsements = [];
    // const transactions = [];

    for (let i = 0; i < mempool.applied.length; i++) {
      if (addedOps.indexOf(mempool.applied[i].hash) < 0) {
        if (mempool.applied[i].branch !== head.hash) continue;
        if (this.badOps.indexOf(mempool.applied[i].hash) >= 0) continue;
        // if (this.operationPass(mempool.applied[i]) === 3) continue; // @TODO: Fee filter, filter modules
        addedOps.push(mempool.applied[i].hash);
        operations[this.operationPass(mempool.applied[i])].push({
          // @ts-ignore
          protocol: head.protocol,
          // @ts-ignore
          branch: mempool.applied[i].branch,
          // @ts-ignore
          contents: mempool.applied[i].contents,
          // @ts-ignore
          signature: mempool.applied[i].signature,
        });
      }
    }

    const header = {
      protocol_data: {
        protocol: head.protocol,
        priority,
        proof_of_work_nonce: '0000000000000000',
        signature:
          'edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q',
      },
      operations,
    };
    if (nonceHash !== '') {
      // @ts-ignore
      header.protocol_data.seed_nonce_hash = nonceHash;
    }

    let preAppliedBlock;
    try {
      preAppliedBlock = await this.query(
        `/chains/${head.chain_id}/blocks/${
          head.hash
        }/helpers/preapply/block?sort=true&timestamp=${Math.max(
          this.dateToTime(this.getDateNow()),
          this.dateToTime(timestamp),
        )}`,
        header,
      );
    } catch (e) {
      if (
        e[0] &&
        e[0].id ===
          'proto.006-PsCARTHA.operation.not_enought_endorsements_for_priority'
      ) {
        this.requiredEndorsements = e[0].required;
        console.log(`Required endorsements: ${this.requiredEndorsements}`);
        await sleep(500);
        return this.bake(head, priority, timestamp);
      }
      console.error('\x1b[91mPreapply failed\x1b[0m', e);
      this.logOutput("\x1b[91m!Couldn't bake - send 0 op bake instead\x1b[0m");
      header.operations = [[], [], [], []];
      preAppliedBlock = await this.query(
        `/chains/${head.chain_id}/blocks/${
          head.hash
        }/helpers/preapply/block?sort=true&timestamp=${Math.max(
          this.dateToTime(this.getDateNow()),
          this.dateToTime(timestamp),
        )}`,
        header,
      );
    }

    this.logOutput('\x1b[96m!Starting POW...\x1b[0m');
    ({ operations } = preAppliedBlock);
    const { shell_header: shellHeader } = preAppliedBlock;

    return new Promise(resolve => {
      shellHeader.protocol_data = this.createProtocolData(priority);
      const ops = [];
      for (let i = 0; i < operations.length; i++) {
        const oo = [];
        // @ts-ignore
        for (let ii = 0; ii < operations[i].applied.length; ii++) {
          oo.push({
            // @ts-ignore
            branch: operations[i].applied[ii].branch,
            // @ts-ignore
            data: operations[i].applied[ii].data,
          });
        }
        ops.push(oo);
      }

      // @ts-ignore
      operations = ops;

      return this.query(
        `/chains/${head.chain_id}/blocks/${head.hash}/helpers/forge_block_header`,
        shellHeader,
      ).then(async (rr: any) => {
        const forged = rr.block.substring(0, rr.block.length - 22);
        let signed: Signed;
        let sopbytes;
        const start = new Date().getTime();
        this.powLoop(
          forged,
          priority,
          seedHex,
          async (blockbytes: string | number, att: number) => {
            const secs = ((new Date().getTime() - start) / 1000).toFixed(3);
            this.logOutput(
              `\x1b[96m+POW found in ${att} attempts (${secs} seconds - ${(
                att /
                parseFloat(secs) /
                1000
              ).toFixed(3)} Kh/s)\x1b[0m`,
            );
            signed = await this.key.sign(
              blockbytes,
              utility.mergebuf(
                constants.watermark.block,
                utility.b58cdecode(head.chain_id, constants.prefix.Net),
              ),
            );
            sopbytes = signed.sbytes;
            resolve({
              data: sopbytes,
              operations,
            });
          },
        );
      });
    }).then(r => ({
      timestamp,
      data: r,
      seed_nonce_hash: seedHex,
      seed,
      level: newLevel,
      chain_id: head.chain_id,
    }));
  };

  // Utility
  powLoop = (
    forged: string,
    priority: number,
    seedHex: string,
    cb: (arg0: string, arg1: number) => Promise<any>,
  ) => {
    const pdd = this.createProtocolData(
      priority,
      this.CONSTANTS.powHeader,
      '00000000',
      seedHex,
    );
    const blockbytes = forged + pdd;
    const hashBuffer = utility.hex2buf(
      `${blockbytes}00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`,
    );
    const forgedLength = forged.length / 2;
    const priorityLength = 2;
    const powHeaderLength = 4;
    const protocolOffset = forgedLength + priorityLength + powHeaderLength;
    const powLength = 4;
    const syncBatchSize = 2000;
    let powLoopHelper: any;
    (powLoopHelper = async (att: number, syncAtt: number) => {
      att++;
      syncAtt++;

      for (let i = powLength - 1; i >= 0; i--) {
        if (hashBuffer[protocolOffset + i] === 255)
          hashBuffer[protocolOffset + i] = 0;
        else {
          hashBuffer[protocolOffset + i]++;
          break;
        }
      }

      const checkedHash = await this.checkHash(hashBuffer);
      if (checkedHash) {
        let hex = utility.buf2hex(hashBuffer);
        hex = hex.substr(0, hex.length - 128);
        cb(hex, att);
      } else if (syncAtt < syncBatchSize) {
        powLoopHelper(att, syncAtt);
      } else {
        // @ts-ignore
        setImmediate(powLoopHelper, att, 0);
      }
    })(0, 0);
  };

  createProtocolData = (
    priority: number,
    powHeader: string = '',
    pow: string = '',
    seed: string = '',
  ) =>
    `${priority.toString(16).padStart(4, '0')}${powHeader.padEnd(
      8,
      '0',
    )}${pow.padEnd(8, '0')}${seed ? `ff${seed.padEnd(64, '0')}` : '00'}`;

  checkHash = async (buf: any) => {
    try {
      await _sodium.ready;
    } catch (e) {
      throw new Error(e);
    }

    const sodium = _sodium;
    const rr = sodium.crypto_generichash(32, buf);
    return this.stampcheck(rr) <= this.CONSTANTS.threshold;
  };

  stampcheck = (s: any) => {
    let value = 0;
    for (let i = 0; i < 8; i++) {
      value = value * 256 + s[i];
    }
    return value;
  };

  // Utility Functions
  dateToTime = (dd: any) => new Date(dd).getTime() / 1000;

  getDateNow = () => `${new Date().toISOString().substr(0, 19)}Z`;

  operationPass = (applied: any) => {
    if (applied.contents.length === 1) {
      switch (applied.contents[0].kind) {
        case 'endorsement':
          return 0;
        case 'proposals':
        case 'ballot':
          return 1;
        case 'seed_nonce_revelation':
        case 'double_endorsement_evidence':
        case 'double_baking_evidence':
        case 'activate_account':
          return 2;
        default:
          return 3;
      }
    } else {
      return 3;
    }
  };

  load = (s: any) => {
    this.store = s;
    this.loadNonces();
  };

  start = () => {
    this.logOutput('\x1b[96mStarting baker...\x1b[0m');
    if (this.bakeIntervalId) {
      // @ts-ignore
      clearInterval(this.bakeIntervalId);
      this.bakeIntervalId = false;
    }
    // @ts-ignore
    this.bakeIntervalId = setInterval(() => this.run(), 1000);
    return this.bakeIntervalId;
  };

  stop = () => {
    this.logOutput('\x1b[96mStopping baker...\x1b[0m');
    if (this.bakeIntervalId) {
      // @ts-ignore
      clearInterval(this.bakeIntervalId);
      this.bakeIntervalId = false;
    }
  };
}

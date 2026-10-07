import { TransactionBuilder, Keypair, Contract, nativeToScVal, Account } from '@stellar/stellar-sdk';

const admin = Keypair.random();
const toUser = Keypair.random();
const contract = new Contract('CBCPBJRLCRZZ3C4EHZPU4WWCYJVIP24XEKRQQKF2CDK7PKAUHEHQBXWL');

const tx = new TransactionBuilder(new Account(admin.publicKey(), '0'), { fee: '10000', networkPassphrase: 'Test SDF Network ; September 2015' })
    .addOperation(contract.call('transfer_auth', 
       nativeToScVal(admin.publicKey(), { type: 'address' }), 
       nativeToScVal(toUser.publicKey(), { type: 'address' }), 
       nativeToScVal(500, { type: 'i128' })))
    .setTimeout(300)
    .build();

const parsed = TransactionBuilder.fromXDR(tx.toXDR(), 'Test SDF Network ; September 2015');
console.dir(parsed.operations[0], { depth: 4 });

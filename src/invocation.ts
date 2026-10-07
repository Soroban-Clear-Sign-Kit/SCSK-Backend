import { Operation, xdr, Address, hash } from '@stellar/stellar-sdk';
import { Invocation, DecodedArg } from './types.js';
import { loadSpec, SAC_FUNCTIONS, SpecLoaderOptions } from './spec.js';
import { decodeScVal } from './scval.js';
import { WarningCode } from './errors.js';

export async function decodeInvocation(
  op: xdr.Operation,
  opts: SpecLoaderOptions
): Promise<{ invocation: Invocation; warnings: { code: WarningCode; message: string }[] }> {
  const warnings: { code: WarningCode; message: string }[] = [];

  const body = op.body;
  if (body.type !== 'invokeHostFunction') {
    warnings.push({ code: 'CLASSIC_OP_NOT_DECODED', message: 'Operation is not invokeHostFunction' });
    return { invocation: { contractId: '', functionName: body.type, args: [], specSource: 'none' }, warnings };
  }

  const invokeOp = body.value;
  const func = invokeOp.hostFunction;
  const funcSwitch = func.type;

  if (funcSwitch === 'hostFunctionTypeInvokeContract') {
    const invokeArgs = func.value;
    const contractId = Address.fromScAddress(invokeArgs.contractAddress).toString();
    const functionName = typeof invokeArgs.functionName === 'string'
      ? invokeArgs.functionName
      : (typeof invokeArgs.functionName?.toString === 'function'
          ? invokeArgs.functionName.toString()
          : String(invokeArgs.functionName));
    const args = invokeArgs.args;

    const specResult = await loadSpec(contractId, opts);
    warnings.push(...specResult.warnings);

    let decodedArgs: DecodedArg[] = [];

    if (specResult.source === 'sac-builtin') {
      const sacDef = SAC_FUNCTIONS[functionName];
      if (sacDef) {
        if (args.length !== sacDef.args.length) {
          warnings.push({ code: 'ARG_COUNT_MISMATCH', message: 'Argument count does not match SAC definition' });
        }
        decodedArgs = args.map((arg, i) => {
          const expected = sacDef.args[i];
          const res = decodeScVal(arg, null, null);
          warnings.push(...res.warnings);
          return { name: expected?.name || null, typeName: expected?.type || null, value: res.value };
        });
      } else {
        decodedArgs = args.map(arg => {
          const res = decodeScVal(arg, null, null);
          warnings.push(...res.warnings);
          return { name: null, typeName: null, value: res.value };
        });
      }
    } else if (specResult.spec) {
      const spec = specResult.spec;
      const funcEntry = spec.getFunc(functionName);
      if (funcEntry) {
        const inputs = funcEntry.inputs;
        if (args.length !== inputs.length) {
          warnings.push({ code: 'ARG_COUNT_MISMATCH', message: 'Argument count does not match contract spec' });
        }
        decodedArgs = args.map((arg, i) => {
          const input = inputs[i];
          const name = input ? (typeof input.name === 'string' ? input.name : Buffer.from(input.name as any).toString('utf8')) : null;
          const typeDef = input ? input.type : null;
          
          if (typeDef) {
            const expectedName = typeDef.type.replace('scSpecType', '').toLowerCase();
            const actualName = arg.type.replace('scv', '').toLowerCase();
            
            // Simple type mismatch check for primitives
            const isPrimitive = ['u32', 'i32', 'u64', 'i64', 'u128', 'i128', 'u256', 'i256', 'bool', 'void', 'bytes', 'string', 'symbol', 'address'].includes(expectedName);
            if (isPrimitive && expectedName !== actualName) {
               // scSpecTypeAddress maps to scvAddress, etc.
               // but Timepoint maps to U64, Duration to U64
               if (!(expectedName === 'timepoint' && actualName === 'u64') && !(expectedName === 'duration' && actualName === 'u64')) {
                 warnings.push({ code: 'ARG_TYPE_MISMATCH', message: `Expected ${expectedName}, got ${actualName}` });
               }
            }
          }

          const res = decodeScVal(arg, spec, typeDef);
          warnings.push(...res.warnings);
          return { name, typeName: typeDef ? typeDef.type : null, value: res.value };
        });
      } else {
        decodedArgs = args.map(arg => {
          const res = decodeScVal(arg, null, null);
          warnings.push(...res.warnings);
          return { name: null, typeName: null, value: res.value };
        });
      }
    } else {
      decodedArgs = args.map(arg => {
        const res = decodeScVal(arg, null, null);
        warnings.push(...res.warnings);
        return { name: null, typeName: null, value: res.value };
      });
    }

    return {
      invocation: { contractId, functionName, args: decodedArgs, specSource: specResult.source },
      warnings,
    };
  } else if (funcSwitch === 'hostFunctionTypeCreateContract' || funcSwitch === 'hostFunctionTypeCreateContractV2') {
    warnings.push({ code: 'CONTRACT_DEPLOYMENT', message: 'Transaction deploys a contract' });
    
    let deployer = 'Unknown';
    let salt = '';
    let executable = '';
    
    if (funcSwitch === 'hostFunctionTypeCreateContract') {
       const createArgs = func.value;
       if (createArgs.contractIdPreimage.type === 'contractIdPreimageFromAddress') {
          const preImg = createArgs.contractIdPreimage.value;
          deployer = Address.fromScAddress(preImg.address).toString();
          const rawSalt = (preImg.salt as any)?.value ?? preImg.salt;
          salt = Buffer.from(rawSalt as any).toString('hex');
       }
       if (createArgs.executable.type === 'contractExecutableWasm') {
          const rawWasm = (createArgs.executable.value as any)?.value ?? createArgs.executable.value;
          executable = Buffer.from(rawWasm as any).toString('hex');
       } else if (createArgs.executable.type === 'contractExecutableStellarAsset') {
          executable = 'Stellar Asset';
       }
    } else {
       // hostFunctionTypeCreateContractV2
       const createArgs = func.value;
       if (createArgs.contractIdPreimage.type === 'contractIdPreimageFromAddress') {
          const preImg = createArgs.contractIdPreimage.value;
          deployer = Address.fromScAddress(preImg.address).toString();
          const rawSalt = (preImg.salt as any)?.value ?? preImg.salt;
          salt = Buffer.from(rawSalt as any).toString('hex');
       }
       if (createArgs.executable.type === 'contractExecutableWasm') {
          const rawWasm = (createArgs.executable.value as any)?.value ?? createArgs.executable.value;
          executable = Buffer.from(rawWasm as any).toString('hex');
       } else if (createArgs.executable.type === 'contractExecutableStellarAsset') {
          executable = 'Stellar Asset';
       }
    }

    return {
      invocation: {
        contractId: 'Deploy',
        functionName: 'Deploy contract',
        args: [
          { name: 'deployer', typeName: 'address', value: { kind: 'address', value: deployer, addressType: 'account' } },
          { name: 'salt', typeName: 'bytes', value: { kind: 'bytes', hex: salt, length: salt.length / 2, truncated: false } },
          { name: 'executable', typeName: 'string', value: { kind: 'string', value: executable, sanitized: false, truncated: false } }
        ],
        specSource: 'none',
      },
      warnings
    };
  } else if (funcSwitch === 'hostFunctionTypeUploadContractWasm') {
    warnings.push({ code: 'WASM_UPLOAD', message: 'Transaction uploads contract code' });
    const wasmBytes = (func.value as any)?.value ?? func.value;
    const wasmHash = Buffer.from(hash(wasmBytes) as any).toString('hex');
    return {
      invocation: {
        contractId: 'Upload',
        functionName: 'Upload contract code',
        args: [
          { name: 'length', typeName: 'u32', value: { kind: 'int', type: 'u32', value: wasmBytes.length.toString() } },
          { name: 'hash', typeName: 'bytes', value: { kind: 'bytes', hex: wasmHash, length: 32, truncated: false } }
        ],
        specSource: 'none'
      },
      warnings
    };
  }

  return {
    invocation: { contractId: '', functionName: 'Unknown', args: [], specSource: 'none' },
    warnings
  };
}

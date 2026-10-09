import { xdr } from "@stellar/stellar-sdk";
const x = new xdr.DiagnosticEvent({
  inSuccessfulContractCall: true,
  event: new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: null,
    type: xdr.ContractEventType.contractEventTypeContract(),
    body: xdr.ContractEventBody.contractEventBodyV0(
      new xdr.ContractEventV0({
        topics: [],
        data: xdr.ScVal.scvVoid(),
      }),
    ),
  }),
});
console.log(typeof x.inSuccessfulContractCall);

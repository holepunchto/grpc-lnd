const path = require('path')
const fs = require('fs')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const b4a = require('b4a')
const { serviceTypes, packageTypes, protoFiles } = require('./services.json')

process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'

module.exports = lightningRpc

/* opts = {
  lnddir,
  network,
  rpcPort
} */

function lightningRpc (opts = {}) {
  if (opts.lndDir) {
    opts.macaroon = fs.readFileSync(path.join(opts.lndDir, 'data', 'chain', 'bitcoin', opts.network, 'admin.macaroon')).toString('base64')
    opts.cert = fs.readFileSync(path.join(opts.lndDir, 'tls.cert')).toString('base64')
  }

  const socket = opts.socket || 'localhost:10009'

  // build metadata credentials
  const metadata = new grpc.Metadata()
  metadata.add('macaroon', b4a.from(opts.macaroon, 'base64').toString('hex'))
  const macaroonCreds = grpc.credentials.createFromMetadataGenerator((_args, callback) => {
    callback(null, metadata)
  })

  // build ssl credentials
  const sslCreds = grpc.credentials.createSsl(b4a.from(opts.cert, 'base64'))

  // combine cert credentials and macaroon auth credentials
  const credentials = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds)

  const params = {
    'grpc.max_receive_message_length': -1,
    'grpc.max_send_message_length': -1
  }

  // pass the credentials when creating a channel
  return {
    lnd: Object.entries(serviceTypes).reduce((services, [type, service]) => {
      services[type] = createRpcClient({
        credentials,
        params,
        service,
        path: pathForProto(packageTypes[service], protoFiles[service]),
        socket,
        type: packageTypes[service]
      })
      return services
    }, {})
  }
}

function getPackageDefinition (file) {
  return protoLoader.loadSync(
    file,
    {
      includeDirs: [
        path.join(__dirname, './proto')
      ],
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    }
  )
}

function createRpcClient ({ credentials, params, path, service, type, socket }) {
  // pass the credentials when creating a channel
  const packageDefinition = getPackageDefinition(path)
  const rpc = grpc.loadPackageDefinition(packageDefinition)

  return new rpc[type][service](socket, credentials, params)
}

function pathForProto (type, file) {
  return path.join(__dirname, 'proto', file)
}

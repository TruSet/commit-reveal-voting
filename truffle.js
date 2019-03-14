let compilers = {
  solc: {
    version: '0.4.25',
    docker: false,
  },
}

module.exports = {
  compilers,
  networks: {
    development: {
      host: 'localhost',
      port: 8545,
      network_id: '*', // eslint-disable-line camelcase
    },
    ganache: {
      host: 'localhost',
      port: 7545,
      network_id: '*', // eslint-disable-line camelcase
    },
  },
}

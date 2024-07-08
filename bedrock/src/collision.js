const fs = require('fs')
const nbt = require('prismarine-nbt')
const stringify = require("json-stringify-pretty-compact")
const assert = require('assert')
const strip = k => k.replace('minecraft:', '').split('[')[0]
const sequential = data => {
  data = data.map(k => parseInt(k))
  if (data.length < 2) return true
  for (let i = data[0], j = 0; i <= data[data.length - 1]; i++, j++) {
    // console.log(data[j], data[0] + j)
    if (data[j] != (data[0] + j)) return false
    // if (data[data[0] + j] != (data[0] + j)) return false
  }
  return true
}

module.exports = async (version, outputPath) => {
  if(fs.existsSync('./deps/mappings/collisions.nbt')){
    return await createCollosionDataV2(version, outputPath);
  }

  const geyserMappings = require('./deps/mappings/blocks.json')
  const collisions = require('./deps/mappings/collision.json')
  const bedrockBlockStates = require(`./${outputPath}/blocks/BlockStates.json`)

  const buildBSS = states => {
    let s = []
    for (const k in states) {
      const v = states[k]
      s.push(`${k}=${v}`)
    }
    return s.join(',')
  }

  function getStateIDFor(name, states) {
    // if (!states) return ""
    for (const i in bedrockBlockStates) {
      const block = bedrockBlockStates[i]
      // console.log(block.name, name, states)
      if (block.name === name.replace('minecraft:', '')) {
        let failed
        if (!states) return i
        for (const [state, value] of Object.entries(states)) {
          // console.log(block.states.value, state, value)
          if (block.states[state]?.value != value) { failed = true; break }
        }
        if (!failed) return i
      }
    }
  }

  const out = {}
  const col = {}
  // console.log(collisions)
  // return


  /**
   * The following code builds a map of blockIdName => Array of block state indexes
   */
  for (const javaId in geyserMappings) {
    const maping = geyserMappings[javaId]
    const ss = buildBSS(maping.bedrock_states)
    // This is a mapping that contains bedrock block names as their keys, and 
    // their indexes to the collisions map as their values. We need to make sure
    // We need to make sure 
    const o = (out[`${strip(maping.bedrock_identifier)}`] ??= {})
    // console.log(maping)

    // Put a second map into `o` that maps state IDs for each of the bedrock block names
    // to a collision index.
    const stateID = getStateIDFor(maping.bedrock_identifier, maping.bedrock_states)
    // console.log('stateID', stateID, maping)
    assert(stateID, `Could not find stateID for ${maping.bedrock_identifier}`)
    o[stateID] = maping.collision_index

    // Make sure that the `o` map's keys of BRIDs are sequential and don't have any gaps.
    // That's because we do minStateId + stateNumber to figure out which collision to use. 
    const keys = Object.keys(o)
    // console.log('keys', keys)
    // Get the "default" collision index for this block in case a missing block state doesn't have one.
    // The default is just the first one we find.
    const defVal = o[keys[0]]
    // console.log('defVal', defVal)

    if (!sequential(keys)) {
      // console.warn(`⚠ GAP in collisions for ${maping.bedrock_identifier} / ${javaId}, ${keys} -- filling in`)
      let lastVal
      for (let i = parseInt(keys[0]); i <= parseInt(keys[keys.length - 1]); i++) {
        o[i] ??= defVal
        // console.log('I', i, o[i])
      }
      // console.log('Now: ' + JSON.stringify(Object.entries(o)), defVal)
      if (!sequential(Object.keys(o))) throw Error()
    }
    // assert(sequential(keys), `GAP! ${javaId}, ${keys}`)

    col[maping.collision_index] = collisions[maping.collision_index]
  }

  for (const key in out) {
    const minStateId = getStateIDFor('minecraft:'+key)
    const val = out[key]
    const keys = Object.keys(val).map(k => parseInt(k))
    const next = []
    for (let i = minStateId; i <= keys[keys.length - 1]; i++) {
      if (val[i] != null) next.push(val[i])
      else next.push(0)
    }
    out[key] = next
    console.log('Next', next, minStateId, keys[keys.length - 1])
    if (next.length < keys.length) throw Error()
  }
  
  fs.writeFileSync(outputPath + '/blockCollisionShapes.json', stringify({ blocks: out, shapes: col }, { indent: '\t', maxLength: 19999 }))

  // console.log(out)
}

async function createCollosionDataV2(version, outputPath){
  const collisionBlockStates =fs.readFileSync('./collision_block_state_names.txt', {encoding: 'utf-8'}).split('\r\n');
  const blocksJ2B = require('./output/blocks/Java2Bedrock.json');
  const BSS = require('./output/blocks/BSS.json')
  const blocksJSON = require('./output/blocks.json')

  const collisionsData =fs.readFileSync(`./deps/mappings/collisions.nbt`);
  const collisionsNbt = await nbt.parse(collisionsData);
  const collisionsJSON = nbt.simplify(collisionsNbt.parsed);

  const collisions = {
    blocks: {}, 
    shapes: {}
  }

  const bedrockBlockStateId_2_collisionIndex = {};

  for(const bedrockBlockIndex in collisionBlockStates){
    let name = collisionBlockStates[bedrockBlockIndex];

    if(!collisions.blocks[strip(name)]){
      const key = name + (name.includes('[') ? '' : '[]');
      const bedrockStateName = blocksJ2B[key];

      if(bedrockStateName == null){
        throw new Error('not found bedrock block state name')
      }
      const index = BSS[jss2bss(bedrockStateName)]

      if(index == null){
        throw new Error('not found bedrock block state id')
      }

      bedrockBlockStateId_2_collisionIndex[index]= bedrockBlockIndex;
    }else{
      throw new Error('unhandled case.')
    }
  }

  for(const bedrockBlockIndex in blocksJSON){
    let bedrockBlock = blocksJSON[bedrockBlockIndex];
     for(let stateId = bedrockBlock.minStateId; stateId <= bedrockBlock.maxStateId; stateId++){
      if(!collisions.blocks[strip(bedrockBlock.name)]){
          collisions.blocks[strip(bedrockBlock.name)] = []
      }

      if(bedrockBlockStateId_2_collisionIndex[stateId] != undefined){
        collisions.blocks[strip(bedrockBlock.name)].push(collisionsJSON.indices[bedrockBlockStateId_2_collisionIndex[stateId]]);
      }else{
        collisions.blocks[strip(bedrockBlock.name)].push(0);
      }       
    }
  }
  
  for (const key in collisionsJSON.collisions) {
    const value = collisionsJSON.collisions[key]  
    collisions.shapes[key] = value;
  }
  
  fs.writeFileSync(outputPath + '/blockCollisionShapes.json', stringify(collisions, { indent: '\t', maxLength: 19999 })) 
  fs.writeFileSync(outputPath + '/minecraft-data/blockCollisionShapes.json', stringify(collisions, { indent: '\t', maxLength: 19999 })) 
}

function jss2bss(val) {
  val = val.replace(/=true/g, '=1')
  val = val.replace(/=false/g, '=0')
  return val
}


if (!module.parent) module.exports(null, '1.17.10')
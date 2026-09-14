// Unity SerializedFile reader (format versions 17-22): header, types with
// type trees, object table, and a generic type-tree driven object decoder.

// Unity 2018.4 common string buffer: NUL-separated, offset = byte position.
const COMMON_LIST = [
  'AABB', 'AnimationClip', 'AnimationCurve', 'AnimationState', 'Array', 'Base', 'BitField', 'bitset', 'bool', 'char',
  'ColorRGBA', 'Component', 'data', 'deque', 'double', 'dynamic_array', 'FastPropertyName', 'first', 'float', 'Font',
  'GameObject', 'Generic Mono', 'GradientNEW', 'GUID', 'GUIStyle', 'int', 'list', 'long long', 'map', 'Matrix4x4f',
  'MdFour', 'MonoBehaviour', 'MonoScript', 'm_ByteSize', 'm_Curve', 'm_EditorClassIdentifier', 'm_EditorHideFlags',
  'm_Enabled', 'm_ExtensionPtr', 'm_GameObject', 'm_Index', 'm_IsArray', 'm_IsStatic', 'm_MetaFlag', 'm_Name',
  'm_ObjectHideFlags', 'm_PrefabInternal', 'm_PrefabParentObject', 'm_Script', 'm_StaticEditorFlags', 'm_Type',
  'm_Version', 'Object', 'pair', 'PPtr<Component>', 'PPtr<GameObject>', 'PPtr<Material>', 'PPtr<MonoBehaviour>',
  'PPtr<MonoScript>', 'PPtr<Object>', 'PPtr<Prefab>', 'PPtr<Sprite>', 'PPtr<TextAsset>', 'PPtr<Texture>',
  'PPtr<Texture2D>', 'PPtr<Transform>', 'Prefab', 'Quaternionf', 'Rectf', 'RectInt', 'RectOffset', 'second', 'set',
  'short', 'size', 'SInt16', 'SInt32', 'SInt64', 'SInt8', 'staticvector', 'string', 'TextAsset', 'TextMesh', 'Texture',
  'Texture2D', 'Transform', 'TypelessData', 'UInt16', 'UInt32', 'UInt64', 'UInt8', 'unsigned int',
  'unsigned long long', 'unsigned short', 'vector', 'Vector2f', 'Vector3f', 'Vector4f', 'm_ScriptingClassIdentifier',
  'Gradient', 'Type*', 'int2_storage', 'int3_storage', 'BoundsInt', 'm_CorrespondingSourceObject', 'm_PrefabInstance',
  'm_PrefabAsset', 'FileSize', 'Hash128',
];
const COMMON = new Map();
{ let off = 0; for (const s of COMMON_LIST) { COMMON.set(off, s); off += Buffer.byteLength(s, 'utf8') + 1; } }

const UNSIGNED = new Set(['bool', 'char', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'unsigned short', 'unsigned int', 'unsigned long long']);
const BYTES_ELEM = new Set(['UInt8', 'char']);

export function parseSerialized(buf) {
  const version = buf.readUInt32BE(8);
  if (version < 17 || version > 22) throw new Error('unsupported SerializedFile version ' + version);
  let dataOffset, p;
  if (version >= 22) { dataOffset = Number(buf.readBigUInt64BE(32)); p = 48; }
  else { dataOffset = buf.readUInt32BE(12); p = 20; }
  const le = buf[16] === 0;

  const u8 = () => buf[p++];
  const i16 = () => { const v = le ? buf.readInt16LE(p) : buf.readInt16BE(p); p += 2; return v; };
  const i32 = () => { const v = le ? buf.readInt32LE(p) : buf.readInt32BE(p); p += 4; return v; };
  const u32 = () => { const v = le ? buf.readUInt32LE(p) : buf.readUInt32BE(p); p += 4; return v; };
  const i64 = () => { const v = le ? buf.readBigInt64LE(p) : buf.readBigInt64BE(p); p += 8; return v; };
  const cstr = () => { const e = buf.indexOf(0, p); if (e < 0) throw new Error('unterminated string at ' + p); const s = buf.toString('utf8', p, e); p = e + 1; return s; };
  const align4 = () => { p = (p + 3) & ~3; };

  const unityVersion = cstr();
  const platform = i32();
  const enableTypeTree = u8() !== 0;
  const typeCount = i32();
  const types = [];
  for (let t = 0; t < typeCount; t++) {
    const classID = i32(); const isStripped = u8() !== 0; const scriptTypeIndex = i16();
    if (classID === 114 || classID < 0) p += 16; // script ID
    p += 16; // old type hash
    const tree = [];
    if (enableTypeTree) {
      const nodeCount = i32(); const strSize = i32();
      const nodeSize = version >= 19 ? 32 : 24;
      const nodeStart = p, strStart = p + nodeCount * nodeSize;
      const str = (off) => {
        if (off & 0x80000000) { const s = COMMON.get(off & 0x7fffffff); if (s === undefined) throw new Error('unknown common string offset ' + (off & 0x7fffffff)); return s; }
        if (off >= strSize) throw new Error('local string offset out of range: ' + off);
        const e = buf.indexOf(0, strStart + off); return buf.toString('utf8', strStart + off, e);
      };
      for (let n = 0; n < nodeCount; n++) {
        p = nodeStart + n * nodeSize;
        const nver = i16() & 0xffff; const depth = u8(); const typeFlags = u8();
        const typeOff = u32(), nameOff = u32(); const byteSize = i32(); const index = i32(); const metaFlag = u32();
        tree.push({ depth, type: str(typeOff), name: str(nameOff), byteSize, typeFlags, metaFlag, index, version: nver });
      }
      p = strStart + strSize;
      if (version >= 21) { const depCount = i32(); p += 4 * depCount; }
    }
    types.push({ classID, isStripped, scriptTypeIndex, tree });
  }

  const objectCount = i32();
  const objects = new Map();
  for (let o = 0; o < objectCount; o++) {
    align4();
    const pathID = i64();
    const byteStart = version >= 22 ? Number(i64()) : u32();
    const byteSize = u32();
    const typeIndex = i32();
    const ty = types[typeIndex]; if (!ty) throw new Error(`object ${pathID}: bad type index ${typeIndex}`);
    objects.set(pathID, { pathID, byteStart, byteSize, classID: ty.classID, typeIndex });
  }

  const classIndex = new Map();
  function byClass(classID) {
    if (!classIndex.has(classID)) classIndex.set(classID, [...objects.values()].filter(x => x.classID === classID));
    return classIndex.get(classID);
  }

  // Per-type child lists, computed once.
  const kidsCache = new Map();
  function kidsOf(typeIndex) {
    if (!kidsCache.has(typeIndex)) {
      const tree = types[typeIndex].tree; const kids = tree.map(() => []); const stack = [];
      for (let i = 0; i < tree.length; i++) {
        while (stack.length && tree[stack[stack.length - 1]].depth >= tree[i].depth) stack.pop();
        if (stack.length) kids[stack[stack.length - 1]].push(i);
        stack.push(i);
      }
      kidsCache.set(typeIndex, kids);
    }
    return kidsCache.get(typeIndex);
  }

  function decode(obj) {
    const tree = types[obj.typeIndex].tree;
    if (!tree.length) throw new Error(`object ${obj.pathID}: no type tree`);
    const kids = kidsOf(obj.typeIndex);
    const base = dataOffset + obj.byteStart;
    let r = base;
    const align = () => { r = base + ((r - base + 3) & ~3); };

    function leaf(n) {
      const uns = UNSIGNED.has(n.type); let v;
      switch (n.byteSize) {
        case 1: v = uns ? buf[r] : buf.readInt8(r); break;
        case 2: v = le ? (uns ? buf.readUInt16LE(r) : buf.readInt16LE(r)) : (uns ? buf.readUInt16BE(r) : buf.readInt16BE(r)); break;
        case 4:
          if (n.type === 'float') v = le ? buf.readFloatLE(r) : buf.readFloatBE(r);
          else v = le ? (uns ? buf.readUInt32LE(r) : buf.readInt32LE(r)) : (uns ? buf.readUInt32BE(r) : buf.readInt32BE(r));
          break;
        case 8:
          if (n.type === 'double') v = le ? buf.readDoubleLE(r) : buf.readDoubleBE(r);
          else v = le ? (uns ? buf.readBigUInt64LE(r) : buf.readBigInt64LE(r)) : (uns ? buf.readBigUInt64BE(r) : buf.readBigInt64BE(r));
          break;
        default: throw new Error(`leaf ${n.type} ${n.name} has unsupported byteSize ${n.byteSize}`);
      }
      r += n.byteSize;
      return v;
    }

    function array(i) {
      const n = tree[i]; const ch = kids[i];
      if (ch.length < 2) throw new Error(`array ${n.type} ${n.name} lacks size/data children`);
      const count = Number(value(ch[0]));
      if (!Number.isFinite(count) || count < 0 || count > buf.length) throw new Error(`array ${n.name}: bad size ${count}`);
      const e = ch[1], en = tree[e];
      const leafElem = kids[e].length === 0 && !(en.metaFlag & 0x4000);
      if (leafElem && en.byteSize === 1 && (n.type === 'TypelessData' || BYTES_ELEM.has(en.type))) {
        if (r + count > buf.length) throw new Error(`array ${n.name}: ${count} bytes past end of file`);
        const out = buf.subarray(r, r + count); r += count; return out;
      }
      const out = new Array(count);
      if (leafElem) for (let k = 0; k < count; k++) out[k] = leaf(en);
      else for (let k = 0; k < count; k++) out[k] = value(e);
      return out;
    }

    function value(i) {
      const n = tree[i]; const ch = kids[i]; let v;
      if (n.typeFlags & 1) v = array(i);
      else if (ch.length === 0) v = leaf(n);
      else if (ch.length === 1 && (tree[ch[0]].typeFlags & 1)) {
        const a = ch[0]; const ak = kids[a];
        if (n.type === 'string' && ak.length >= 2 && tree[ak[1]].byteSize === 1 && kids[ak[1]].length === 0) {
          const len = Number(value(ak[0]));
          if (len < 0 || r + len > buf.length) throw new Error(`string ${n.name}: bad length ${len}`);
          v = buf.toString('utf8', r, r + len); r += len;
          if ((tree[a].metaFlag | tree[ak[1]].metaFlag) & 0x4000) align();
        } else v = value(a); // vector/map/set wrapper: collapse to the array
      } else {
        v = {}; for (const c of ch) v[tree[c].name] = value(c);
      }
      if (n.metaFlag & 0x4000) align();
      return v;
    }

    const v = value(0);
    return { value: v, consumed: r - base };
  }

  function objectOf(pathID) {
    const key = typeof pathID === 'bigint' ? pathID : BigInt(pathID);
    const obj = objects.get(key); if (!obj) throw new Error('no object with pathID ' + key);
    return obj;
  }
  function readObject(pathID) { return decode(objectOf(pathID)).value; }
  function readObjectRaw(pathID) { const o = objectOf(pathID); const d = decode(o); return { ...d, byteSize: o.byteSize }; }

  return { version, unityVersion, platform, enableTypeTree, dataOffset, littleEndian: le, types, objects, byClass, readObject, readObjectRaw };
}

// Exposed for tests / diagnostics.
export function commonString(offset) { return COMMON.get(offset); }

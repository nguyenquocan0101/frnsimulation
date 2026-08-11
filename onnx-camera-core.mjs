const DEFAULT_IMAGE_SIZE = 224;
const textDecoder = new TextDecoder();

export function validateOnnxFilename(name) {
  return typeof name === 'string' && /\.onnx$/i.test(name.trim());
}

function readVarint(bytes, start, limit = bytes.length) {
  let value = 0;
  let scale = 1;
  let offset = start;
  for (let count = 0; offset < limit && count < 10; count += 1) {
    const byte = bytes[offset++];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, offset };
    scale *= 128;
  }
  throw new Error('Invalid ONNX metadata encoding.');
}

function skipField(bytes, offset, wireType, limit) {
  if (wireType === 0) return readVarint(bytes, offset, limit).offset;
  if (wireType === 1) return offset + 8;
  if (wireType === 5) return offset + 4;
  if (wireType === 2) {
    const length = readVarint(bytes, offset, limit);
    return length.offset + length.value;
  }
  throw new Error(`Unsupported ONNX metadata wire type ${wireType}.`);
}

function parseMetadataEntry(bytes, start, end) {
  let key = '';
  let value = '';
  let offset = start;
  while (offset < end) {
    const tag = readVarint(bytes, offset, end);
    offset = tag.offset;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (wire === 2 && (field === 1 || field === 2)) {
      const length = readVarint(bytes, offset, end);
      const valueEnd = Math.min(end, length.offset + length.value);
      const decoded = textDecoder.decode(bytes.subarray(length.offset, valueEnd));
      if (field === 1) key = decoded;
      else value = decoded;
      offset = valueEnd;
    } else {
      offset = skipField(bytes, offset, wire, end);
    }
  }
  return key ? [key, value] : null;
}

export function extractOnnxMetadata(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const metadata = {};
  let offset = 0;
  try {
    while (offset < bytes.length) {
      const tag = readVarint(bytes, offset);
      offset = tag.offset;
      const field = Math.floor(tag.value / 8);
      const wire = tag.value % 8;
      if (field === 14 && wire === 2) {
        const length = readVarint(bytes, offset);
        const end = Math.min(bytes.length, length.offset + length.value);
        const entry = parseMetadataEntry(bytes, length.offset, end);
        if (entry) metadata[entry[0]] = entry[1];
        offset = end;
      } else {
        offset = skipField(bytes, offset, wire, bytes.length);
      }
    }
  } catch {
    return metadata;
  }
  return metadata;
}

function namesFromObject(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, label]) => String(label));
}

export function parseClassNames(rawNames) {
  if (Array.isArray(rawNames) || (rawNames && typeof rawNames === 'object')) {
    return namesFromObject(rawNames);
  }
  if (typeof rawNames !== 'string' || !rawNames.trim()) return [];
  try {
    return namesFromObject(JSON.parse(rawNames));
  } catch {
    const names = [];
    const pair = /(\d+)\s*:\s*(['"])(.*?)\2(?=\s*,|\s*})/g;
    for (const match of rawNames.matchAll(pair)) names[Number(match[1])] = match[3];
    return names.filter((name) => typeof name === 'string');
  }
}

function metadataAt(metadata, index, name) {
  if (Array.isArray(metadata)) return metadata[index];
  return metadata?.[name] ?? Object.values(metadata ?? {})[index];
}

function concreteDimension(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function resolveModelContract(session, fallbackSize = DEFAULT_IMAGE_SIZE) {
  if (session?.inputNames?.length !== 1 || session?.outputNames?.length !== 1) {
    throw new Error('Model needs exactly one image input and one classification output.');
  }
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const input = metadataAt(session.inputMetadata, 0, inputName);
  const output = metadataAt(session.outputMetadata, 0, outputName);
  const dimensions = input?.shape ?? input?.dimensions ?? input?.dims;
  if (!Array.isArray(dimensions) || dimensions.length !== 4) {
    throw new Error('Model input must be a 4D NCHW image tensor.');
  }
  const batch = concreteDimension(dimensions[0], 0);
  if (batch > 0 && batch !== 1) {
    throw new Error('Model input batch must be 1 or dynamic.');
  }
  const channels = concreteDimension(dimensions[1], 3);
  if (channels !== 3) throw new Error('Model input must use three RGB channels.');
  if (input?.type && input.type !== 'float32') {
    throw new Error(`Model input type ${input.type} is unsupported; export a float32 ONNX model.`);
  }
  const outputDimensions = output?.shape ?? output?.dimensions ?? output?.dims ?? [];
  if (!Array.isArray(outputDimensions) || outputDimensions.length !== 2) {
    throw new Error('Model output must be a rank-2 classification tensor [1, classes].');
  }
  const outputBatch = concreteDimension(outputDimensions[0], 0);
  if (outputBatch > 0 && outputBatch !== 1) {
    throw new Error('Model output batch must be 1 or dynamic.');
  }
  if (output?.type && output.type !== 'float32') {
    throw new Error(`Model output type ${output.type} is unsupported; export a float32 ONNX model.`);
  }
  const knownClasses = concreteDimension(outputDimensions.at?.(-1), 0);
  if (knownClasses === 1) {
    throw new Error('Model output does not look like a classification tensor.');
  }
  return {
    inputName,
    outputName,
    width: concreteDimension(dimensions[3], fallbackSize),
    height: concreteDimension(dimensions[2], fallbackSize),
    knownClasses,
  };
}

export function computeCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every((value) => value > 0)) {
    throw new Error('Image and model dimensions must be positive.');
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / targetRatio;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

export function imageDataToNchw(imageData) {
  const { data, width, height } = imageData;
  if (!data || data.length !== width * height * 4) throw new Error('Invalid RGBA image data.');
  const pixels = width * height;
  const output = new Float32Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    const rgba = index * 4;
    output[index] = data[rgba] / 255;
    output[pixels + index] = data[rgba + 1] / 255;
    output[pixels * 2 + index] = data[rgba + 2] / 255;
  }
  return output;
}

export function topClassifications(values, names = [], limit = 3) {
  const scores = Array.from(values ?? {}, Number);
  if (scores.length < 2 || scores.some((value) => !Number.isFinite(value))) {
    throw new Error('Model output is not a valid classification score vector.');
  }
  const sum = scores.reduce((total, value) => total + value, 0);
  const alreadyProbabilities = scores.every((value) => value >= 0 && value <= 1) && Math.abs(sum - 1) < 0.02;
  const probabilities = alreadyProbabilities
    ? scores
    : (() => {
        const max = Math.max(...scores);
        const exponentials = scores.map((value) => Math.exp(value - max));
        const total = exponentials.reduce((result, value) => result + value, 0);
        return exponentials.map((value) => value / total);
      })();
  return probabilities
    .map((confidence, index) => ({
      index,
      label: names[index] || `class_${index}`,
      confidence,
    }))
    .sort((left, right) => right.confidence - left.confidence || left.index - right.index)
    .slice(0, Math.min(limit, probabilities.length));
}

export function clampNormalizedBox(box) {
  const x1 = Math.max(0, Math.min(1, Math.min(box.x1, box.x2)));
  const y1 = Math.max(0, Math.min(1, Math.min(box.y1, box.y2)));
  const x2 = Math.max(0, Math.min(1, Math.max(box.x1, box.x2)));
  const y2 = Math.max(0, Math.min(1, Math.max(box.y1, box.y2)));
  return { x1, y1, x2, y2 };
}

export function canAddNormalizedBox(box, displayWidth, displayHeight, boxCount, options = {}) {
  const maxBoxes = options.maxBoxes ?? 7;
  const minSize = options.minSize ?? 12;
  const normalized = clampNormalizedBox(box);
  return (
    boxCount < maxBoxes &&
    (normalized.x2 - normalized.x1) * displayWidth >= minSize &&
    (normalized.y2 - normalized.y1) * displayHeight >= minSize
  );
}

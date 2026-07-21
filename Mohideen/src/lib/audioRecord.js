import { NativeEventEmitter, NativeModules } from 'react-native';

const { RNAudioRecord } = NativeModules;

const nativeAudioRecord = RNAudioRecord
  ? {
      ...RNAudioRecord,
      addListener: RNAudioRecord.addListener || (() => {}),
      removeListeners: RNAudioRecord.removeListeners || (() => {}),
    }
  : null;

const eventEmitter = nativeAudioRecord
  ? new NativeEventEmitter(nativeAudioRecord)
  : null;

const eventsMap = {
  data: 'data',
};

const AudioRecord = {
  init(options) {
    return RNAudioRecord?.init(options);
  },
  start() {
    return RNAudioRecord?.start();
  },
  stop() {
    return RNAudioRecord?.stop();
  },
  on(event, callback) {
    const nativeEvent = eventsMap[event];
    if (!nativeEvent || !eventEmitter) {
      throw new Error('Invalid event');
    }
    eventEmitter.removeAllListeners(nativeEvent);
    return eventEmitter.addListener(nativeEvent, callback);
  },
};

export default AudioRecord;

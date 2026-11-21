// AudioWorklet module for the rain-window sound (loaded by audio.js).
import { createVoice } from './sound.js';
import { registerVoice } from '../shared/voice-processor.js';

registerVoice('wa-rain-window', createVoice);

import * as Comlink from 'comlink'

import { loadBundledData } from './bundled-data'
import { Projector } from './projector'

Comlink.expose(new Projector(loadBundledData))

import { createContext } from 'react'
import type { ResultLimit } from '../../api/display-settings-storage'

export const RecommendationDebugContext = createContext(false)
export const RecommendationLimitContext = createContext<ResultLimit>(20)

<script setup lang="ts">
import { ref } from 'vue-lynx'

const count = ref(0)

const onMainThreadTap = () => {
  'main thread'
  console.log('Nasti native backend main-thread worklet')
}
</script>

<template>
  <view class="page">
    <text class="eyebrow">Nasti × Vue Lynx</text>
    <text class="title">One config, Lynx and web.</text>
    <view class="counter" @tap="count++">
      <text>Tap count: {{ count }}</text>
    </view>
    <view class="worklet" :main-thread-bindtap="onMainThreadTap">
      <text>Main-thread worklet ready</text>
    </view>
  </view>
</template>

<style>
.page {
  min-height: 100vh;
  padding: 48px;
  background: #07111f;
}

.eyebrow {
  color: #5eead4;
  font-size: 18px;
}

.title {
  margin-top: 16px;
  color: #f8fafc;
  font-size: 38px;
  font-weight: 700;
}

.counter {
  margin-top: 40px;
  padding: 20px 24px;
  border-radius: 16px;
  color: #07111f;
  background: #5eead4;
}

.worklet {
  margin-top: 16px;
  color: #f8fafc;
}
</style>
